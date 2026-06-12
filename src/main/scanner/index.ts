import { fdir } from 'fdir'
import { stat } from 'fs/promises'
import { dirname, extname } from 'path'
import type Database from 'better-sqlite3'
import { getDatabase } from '../db'
import { CACHE_DIR_NAME, getMediaType } from '../media-types'

export interface ScanProgress {
  phase: 'walking' | 'diffing' | 'inserting' | 'done'
  scanned: number
  total: number
  added: number
  removed: number
  updated: number
  currentPath?: string
}

export type ProgressCallback = (progress: ScanProgress) => void

interface FileEntry {
  path: string
  ext: string
}

/**
 * 扫描根目录，把媒体文件入库（增量同步）
 *
 * 策略：
 * 1. 用 fdir 异步遍历整棵目录树，过滤出图片/视频
 * 2. 与数据库已有记录做 diff
 *    - 路径在 fs 不在 db: 新增
 *    - 路径在 db 不在 fs: 删除
 *    - 路径都在但 mtime/size 变了: 更新
 * 3. 用事务批量写入
 */
export async function scanRoot(
  rootPath: string,
  onProgress?: ProgressCallback
): Promise<ScanProgress> {
  const db = getDatabase()

  // 1) 遍历文件系统
  onProgress?.({ phase: 'walking', scanned: 0, total: 0, added: 0, removed: 0, updated: 0 })

  const allEntries = await crawlMedia(rootPath)
  const fsMap = new Map<string, FileEntry>()
  for (const e of allEntries) fsMap.set(e.path, e)

  onProgress?.({
    phase: 'diffing',
    scanned: allEntries.length,
    total: allEntries.length,
    added: 0,
    removed: 0,
    updated: 0
  })

  // 2) 加载数据库内当前根目录下的记录
  const existing = db
    .prepare(
      `SELECT id, path, mtime, size, unavailable FROM media_files WHERE path LIKE ? ESCAPE '\\'`
    )
    .all(escapeLike(rootPath) + '%') as Array<{
    id: number
    path: string
    mtime: number
    size: number
    unavailable: number
  }>

  const dbMap = new Map<string, { id: number; mtime: number; size: number; unavailable: number }>()
  for (const r of existing) dbMap.set(r.path, r)

  // 3) 计算差异
  const toAdd: FileEntry[] = []
  const toUpdate: FileEntry[] = []
  const toRemove: number[] = []

  for (const [path, entry] of fsMap) {
    const dbRow = dbMap.get(path)
    if (!dbRow) {
      toAdd.push(entry)
    } else {
      // 已存在，判断是否需要更新（mtime 或 size 变了）
      // 这里需要再 stat 一次拿大小；批量 stat 在 insertBatch 里做
      toUpdate.push(entry) // 暂时全标记为待检查
    }
  }

  for (const [path, row] of dbMap) {
    if (!fsMap.has(path)) toRemove.push(row.id)
  }

  // 4) 批量写入
  let added = 0
  let updated = 0
  let removed = toRemove.length
  let scanned = 0
  const total = toAdd.length + toUpdate.length

  // 删除已不存在的
  if (toRemove.length > 0) {
    const placeholders = toRemove.map(() => '?').join(',')
    db.prepare(`DELETE FROM media_files WHERE id IN (${placeholders})`).run(...toRemove)
  }

  // 新增 / 更新
  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO media_files (path, folder_path, type, mtime, size)
    VALUES (?, ?, ?, ?, ?)
  `)

  const updateStmt = db.prepare(`
    UPDATE media_files SET mtime = ?, size = ?, unavailable = 0, unavailable_reason = NULL WHERE id = ?
  `)

  // 解封：扫描时若存在的文件之前被标记 unavailable，但 mtime/size 没变，也要解封
  // （比如：临时锁占用导致缩略图失败被标记，下次扫到就恢复）
  const reviveStmt = db.prepare(`
    UPDATE media_files SET unavailable = 0, unavailable_reason = NULL WHERE id = ?
  `)

  // 用 transaction 包裹批量写入大幅提升性能
  const insertBatch = db.transaction((entries: FileEntry[], stats: Array<{ mtime: number; size: number }>) => {
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]
      const s = stats[i]
      const mediaType = getMediaType(e.ext)
      if (!mediaType) continue
      insertStmt.run(e.path, dirname(e.path), mediaType, s.mtime, s.size)
    }
  })

  // 处理新增（分批 stat + insert）
  const BATCH_SIZE = 200
  for (let i = 0; i < toAdd.length; i += BATCH_SIZE) {
    const batch = toAdd.slice(i, i + BATCH_SIZE)
    const stats = await Promise.all(
      batch.map(async (e) => {
        try {
          const s = await stat(e.path)
          return { mtime: Math.floor(s.mtimeMs), size: s.size }
        } catch {
          return null
        }
      })
    )
    const validBatch: FileEntry[] = []
    const validStats: Array<{ mtime: number; size: number }> = []
    batch.forEach((e, idx) => {
      if (stats[idx]) {
        validBatch.push(e)
        validStats.push(stats[idx]!)
      }
    })
    insertBatch(validBatch, validStats)
    added += validBatch.length
    scanned += batch.length
    onProgress?.({
      phase: 'inserting',
      scanned,
      total,
      added,
      removed,
      updated,
      currentPath: batch[batch.length - 1]?.path
    })
  }

  // 处理已存在的：检查是否真的需要更新
  for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
    const batch = toUpdate.slice(i, i + BATCH_SIZE)
    const updates: Array<{ id: number; mtime: number; size: number }> = []
    const revives: number[] = []

    await Promise.all(
      batch.map(async (e) => {
        try {
          const s = await stat(e.path)
          const newMtime = Math.floor(s.mtimeMs)
          const dbRow = dbMap.get(e.path)!
          if (dbRow.mtime !== newMtime || dbRow.size !== s.size) {
            updates.push({ id: dbRow.id, mtime: newMtime, size: s.size })
          } else if (dbRow.unavailable === 1) {
            // mtime/size 都没变但被标记了失效 → 解封
            revives.push(dbRow.id)
          }
        } catch {
          // 忽略错误
        }
      })
    )

    if (updates.length > 0 || revives.length > 0) {
      const updateBatchTx = db.transaction(
        (items: typeof updates, revivedIds: number[]) => {
          for (const u of items) {
            updateStmt.run(u.mtime, u.size, u.id)
          }
          for (const id of revivedIds) {
            reviveStmt.run(id)
          }
        }
      )
      updateBatchTx(updates, revives)
      updated += updates.length
    }
    scanned += batch.length
    onProgress?.({
      phase: 'inserting',
      scanned,
      total,
      added,
      removed,
      updated,
      currentPath: batch[batch.length - 1]?.path
    })
  }

  // 5) 重建文件夹统计
  rebuildFolderStats(db, rootPath)

  // 6) 保存根目录到 settings
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
    'rootPath',
    rootPath
  )

  const result: ScanProgress = {
    phase: 'done',
    scanned: total,
    total,
    added,
    removed,
    updated
  }
  onProgress?.(result)
  return result
}

/**
 * 用 fdir 高性能遍历目录，返回所有支持的媒体文件
 * 自动跳过缓存目录与隐藏目录
 */
async function crawlMedia(rootPath: string): Promise<FileEntry[]> {
  const crawler = new fdir()
    .withFullPaths()
    .exclude((dirName) => {
      // 跳过缓存目录与隐藏目录
      return (
        dirName === CACHE_DIR_NAME ||
        dirName.startsWith('.') ||
        dirName === 'node_modules' ||
        dirName === 'System Volume Information' ||
        dirName === '$RECYCLE.BIN'
      )
    })
    .filter((path) => {
      const ext = extname(path).toLowerCase()
      return getMediaType(ext) !== null
    })

  const paths = (await crawler.crawl(rootPath).withPromise()) as string[]
  return paths.map((path) => ({
    path,
    ext: extname(path).toLowerCase()
  }))
}

/**
 * 重建 folders 表的统计数据
 * 直接从 media_files 聚合即可
 */
function rebuildFolderStats(db: Database.Database, rootPath: string): void {
  const tx = db.transaction(() => {
    // 清空当前根目录范围的文件夹记录（用 LIKE 匹配）
    db.prepare(`DELETE FROM folders WHERE path LIKE ? ESCAPE '\\'`).run(
      escapeLike(rootPath) + '%'
    )

    // 直接聚合每个文件夹的文件数
    db.prepare(
      `
      INSERT INTO folders (path, parent_path, depth, file_count, recursive_count, mtime)
      SELECT
        folder_path,
        ?,
        ?,
        COUNT(*),
        COUNT(*),
        unixepoch()
      FROM media_files
      WHERE path LIKE ? ESCAPE '\\'
      GROUP BY folder_path
    `
    ).run('', 0, escapeLike(rootPath) + '%')

    // 修正 parent_path 与 depth
    const folders = db
      .prepare(`SELECT id, path FROM folders WHERE path LIKE ? ESCAPE '\\'`)
      .all(escapeLike(rootPath) + '%') as Array<{ id: number; path: string }>

    const updateStmt = db.prepare(
      'UPDATE folders SET parent_path = ?, depth = ? WHERE id = ?'
    )

    for (const f of folders) {
      const relativeFromRoot = f.path.startsWith(rootPath)
        ? f.path.substring(rootPath.length).replace(/^[\\/]+/, '')
        : f.path
      const depth = relativeFromRoot ? relativeFromRoot.split(/[\\/]/).length : 0
      const parent = depth > 0 ? dirname(f.path) : ''
      updateStmt.run(parent, depth, f.id)
    }
  })
  tx()
}

/** 转义 SQL LIKE 中的特殊字符 */
function escapeLike(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}
