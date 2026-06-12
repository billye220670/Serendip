import { protocol } from 'electron'
import { readFile, stat, open } from 'fs/promises'
import { join, extname } from 'path'
import { getDatabase } from '../db'
import { generateImageThumb, generateVideoThumb, ensureCacheDir } from '../thumbnailer'
import { CACHE_DIR_NAME } from '../media-types'

const VIDEO_MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm'
}

/**
 * 注册自定义协议
 *   serendip://thumb/<file_id>  → 缩略图（按需生成）
 *   serendip://video/<file_id>  → 原视频（带 Range 流式响应）
 */
export function registerThumbProtocol(): void {
  protocol.handle('serendip', async (request) => {
    const url = new URL(request.url)

    if (url.hostname === 'thumb') {
      const fileId = parseInt(url.pathname.replace(/^\//, ''), 10)
      if (isNaN(fileId)) {
        return new Response('Invalid file ID', { status: 400 })
      }
      try {
        const thumbPath = await ensureThumb(fileId)
        const buffer = await readFile(thumbPath)
        return new Response(buffer, {
          headers: { 'Content-Type': 'image/webp' }
        })
      } catch (err) {
        console.error(`Failed to serve thumb for file ${fileId}:`, err)
        // 标记失效，避免下次还被推荐
        markUnavailable(fileId, err instanceof Error ? err.message : String(err))
        return new Response('Thumbnail not found', { status: 404 })
      }
    }

    if (url.hostname === 'video') {
      const fileId = parseInt(url.pathname.replace(/^\//, ''), 10)
      if (isNaN(fileId)) {
        return new Response('Invalid file ID', { status: 400 })
      }
      try {
        const filePath = lookupFilePath(fileId)
        if (!filePath) {
          return new Response('File not found', { status: 404 })
        }
        return await serveVideoWithRange(filePath, request)
      } catch (err) {
        console.error(`Failed to serve video for file ${fileId}:`, err)
        return new Response('Video not found', { status: 404 })
      }
    }

    return new Response('Not found', { status: 404 })
  })
}

/**
 * 给 <video> 元素提供带 Range 支持的流式响应。
 * 这是 video 能秒开播放的关键 — 浏览器先发个小 Range 请求拿元数据，
 * 然后再按需拉播放点附近的数据。
 */
async function serveVideoWithRange(
  filePath: string,
  request: Request
): Promise<Response> {
  const stats = await stat(filePath)
  const total = stats.size
  const ext = extname(filePath).toLowerCase()
  const mime = VIDEO_MIME[ext] ?? 'application/octet-stream'

  const rangeHeader = request.headers.get('range') ?? request.headers.get('Range')

  if (rangeHeader) {
    // 解析 "bytes=start-end"
    const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader)
    if (match) {
      const start = match[1] ? parseInt(match[1], 10) : 0
      const end = match[2] ? parseInt(match[2], 10) : total - 1
      const chunkSize = end - start + 1

      const fh = await open(filePath, 'r')
      const stream = fh.createReadStream({ start, end, autoClose: true })
      const webStream = nodeStreamToWebStream(stream)

      return new Response(webStream, {
        status: 206,
        headers: {
          'Content-Type': mime,
          'Content-Length': String(chunkSize),
          'Content-Range': `bytes ${start}-${end}/${total}`,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-cache'
        }
      })
    }
  }

  // 无 Range：整个文件
  const fh = await open(filePath, 'r')
  const stream = fh.createReadStream({ autoClose: true })
  const webStream = nodeStreamToWebStream(stream)

  return new Response(webStream, {
    status: 200,
    headers: {
      'Content-Type': mime,
      'Content-Length': String(total),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache'
    }
  })
}

/** Node.js Readable → Web ReadableStream */
function nodeStreamToWebStream(
  nodeStream: NodeJS.ReadableStream
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      nodeStream.on('data', (chunk: Buffer | string) => {
        const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
        controller.enqueue(new Uint8Array(buf))
      })
      nodeStream.on('end', () => controller.close())
      nodeStream.on('error', (err) => controller.error(err))
    },
    cancel() {
      // 浏览器主动断开时，结束 Node stream（避免 fd 泄漏）
      ;(nodeStream as NodeJS.ReadableStream & { destroy?: () => void }).destroy?.()
    }
  })
}

function lookupFilePath(fileId: number): string | null {
  const db = getDatabase()
  const row = db.prepare('SELECT path FROM media_files WHERE id = ?').get(fileId) as
    | { path: string }
    | undefined
  return row?.path ?? null
}

/**
 * 把文件标记为失效（缩略图生成失败 / 文件丢失 / 解码错误）。
 * 仅在 protocol 层兜底使用；正常流程通过 IPC 由 UI 主动调用。
 */
function markUnavailable(fileId: number, reason: string): void {
  try {
    const db = getDatabase()
    db.prepare(
      'UPDATE media_files SET unavailable = 1, unavailable_reason = ? WHERE id = ?'
    ).run(reason.slice(0, 200), fileId)
  } catch (err) {
    console.error('Failed to mark unavailable:', err)
  }
}

/**
 * 确保缩略图存在，不存在则生成
 * @returns 缩略图的绝对路径
 */
async function ensureThumb(fileId: number): Promise<string> {
  const db = getDatabase()

  // 查询文件记录
  const file = db.prepare(`
    SELECT id, path, folder_path, type, thumb_path, duration_ms
    FROM media_files WHERE id = ?
  `).get(fileId) as {
    id: number
    path: string
    folder_path: string
    type: 'image' | 'video'
    thumb_path: string | null
    duration_ms: number | null
  } | undefined

  if (!file) {
    throw new Error(`File ${fileId} not found in database`)
  }

  // 获取根目录
  const rootRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('rootPath') as
    | { value: string }
    | undefined
  if (!rootRow) {
    throw new Error('Root path not set')
  }
  const rootPath = rootRow.value
  const cacheDir = join(rootPath, CACHE_DIR_NAME, 'thumbs')
  await ensureCacheDir(cacheDir)

  // 如果已有缩略图记录且文件存在，直接返回
  if (file.thumb_path) {
    const thumbAbsPath = join(cacheDir, file.thumb_path)
    try {
      await readFile(thumbAbsPath)
      return thumbAbsPath
    } catch {
      // 缩略图丢失，重新生成
    }
  }

  // 生成缩略图
  if (file.type === 'image') {
    const { thumbPath, width, height } = await generateImageThumb(file.path, cacheDir)
    db.prepare(
      'UPDATE media_files SET thumb_path = ?, width = ?, height = ? WHERE id = ?'
    ).run(thumbPath, width, height, fileId)
    return join(cacheDir, thumbPath)
  } else {
    const { thumbPath, durationMs, width, height } = await generateVideoThumb(
      file.path,
      cacheDir
    )
    db.prepare(
      'UPDATE media_files SET thumb_path = ?, duration_ms = ?, width = ?, height = ? WHERE id = ?'
    ).run(thumbPath, durationMs, width, height, fileId)
    return join(cacheDir, thumbPath)
  }
}
