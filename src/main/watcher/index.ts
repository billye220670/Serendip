import { watch, type FSWatcher } from 'chokidar'
import { stat } from 'fs/promises'
import { dirname, extname } from 'path'
import { getDatabase } from '../db'
import { getMediaType } from '../media-types'

interface FileChange {
  type: 'add' | 'change' | 'unlink'
  path: string
}

let watcher: FSWatcher | null = null
let changeQueue: FileChange[] = []
let flushTimer: NodeJS.Timeout | null = null

export function startWatcher(rootPath: string): void {
  stopWatcher()

  watcher = watch(rootPath, {
    ignored: [
      /(^|[/\\])\../,
      '**/node_modules/**',
      '**/.serendip-cache/**',
      '**/System Volume Information/**',
      '**/$RECYCLE.BIN/**'
    ],
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 }
  })

  watcher
    .on('add', (path) => queueChange({ type: 'add', path }))
    .on('change', (path) => queueChange({ type: 'change', path }))
    .on('unlink', (path) => queueChange({ type: 'unlink', path }))
    .on('error', (error) => console.error('[Watcher] Error:', error))
}

export function stopWatcher(): void {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
    void flushChanges()
  }
  if (watcher) {
    void watcher.close()
    watcher = null
  }
  changeQueue = []
}

function queueChange(change: FileChange): void {
  if (!getMediaType(extname(change.path).toLowerCase())) return
  changeQueue.push(change)
  scheduleFlush()
}

function scheduleFlush(): void {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    void flushChanges()
  }, 500)
}

async function flushChanges(): Promise<void> {
  if (changeQueue.length === 0) return
  const batch = changeQueue.splice(0)

  const statsMap = new Map<string, { mtime: number; size: number }>()
  await Promise.all(
    batch.map(async (change) => {
      if (change.type === 'add' || change.type === 'change') {
        try {
          const s = await stat(change.path)
          statsMap.set(change.path, { mtime: Math.floor(s.mtimeMs), size: s.size })
        } catch {
          // 文件消失，跳过
        }
      }
    })
  )

  const db = getDatabase()
  const insertStmt = db.prepare(`
    INSERT INTO media_files (path, folder_path, type, mtime, size)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET mtime=excluded.mtime, size=excluded.size, unavailable=0, unavailable_reason=NULL
  `)
  const deleteStmt = db.prepare('DELETE FROM media_files WHERE path = ?')

  const tx = db.transaction(() => {
    let added = 0
    let removed = 0

    for (const change of batch) {
      const mediaType = getMediaType(extname(change.path).toLowerCase())
      if (!mediaType) continue

      if (change.type === 'add' || change.type === 'change') {
        const s = statsMap.get(change.path)
        if (!s) continue
        insertStmt.run(change.path, dirname(change.path), mediaType, s.mtime, s.size)
        added++
      } else if (change.type === 'unlink') {
        const info = deleteStmt.run(change.path)
        if (info.changes > 0) removed++
      }
    }

    if (added + removed > 0) {
      console.log(`[Watcher] Processed: +${added} -${removed}`)
    }
  })
  tx()
}
