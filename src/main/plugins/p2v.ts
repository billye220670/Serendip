/**
 * P2V 插件 — 将本地媒体文件推送到正在运行的 pix2real（外部图片推送 API）
 *
 * 契约（路径版 application/json）：
 *   POST http://localhost:3000/api/external-image-push
 *   body { workflowId: 0-10 整数, filePath: 绝对路径, originalName?: 文件名 }
 *   成功返回 200 { ok: true, stagingId }，无需鉴权。
 */

import { existsSync } from 'fs'
import path from 'path'
import { getDatabase } from '../db'

/**
 * 将选中的文件逐个推送到 pix2real。
 * - 文件不存在计入 failed 并跳过
 * - 首次请求即连接失败（pix2real 未运行）时直接返回带 error 的结果
 */
export async function pushImages(
  fileIds: number[],
  workflowId: number,
  port: number = 3000
): Promise<{ sent: number; failed: number; error?: string }> {
  console.log('[P2V] pushImages called', { fileIds, workflowId, port })
  const base = `http://localhost:${port}`
  const db = getDatabase()
  const select = db.prepare('SELECT path FROM media_files WHERE id = ?')

  let sent = 0
  let failed = 0
  let firstRequest = true

  for (const id of fileIds) {
    const row = select.get(id) as { path: string } | undefined
    const filePath = row?.path
    if (!row) {
      console.log('[P2V] no db row for id', id, '— skipping')
      failed += 1
      continue
    }
    if (!filePath) {
      console.log('[P2V] no db row for id', id, '— skipping')
      failed += 1
      continue
    }
    console.log('[P2V] resolved path for id', id, '->', filePath)
    if (!existsSync(filePath)) {
      console.log('[P2V] file not found:', filePath, '— skipping')
      failed += 1
      continue
    }

    const url = `${base}/api/external-image-push`
    const body = { workflowId, filePath, originalName: path.basename(filePath) }
    console.log('[P2V] sending to', url, JSON.stringify(body))

    const controller = new AbortController()
    const t = setTimeout(() => controller.abort(), 8000)
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      })
      firstRequest = false

      if (resp.ok) {
        const json = (await resp.json().catch(() => null)) as { ok?: boolean } | null
        console.log('[P2V] response status:', resp.status, 'body:', json)
        if (json?.ok === true) {
          sent += 1
        } else {
          failed += 1
        }
      } else {
        const json = await resp.json().catch(() => 'parse failed')
        console.log('[P2V] response status:', resp.status, 'body:', json)
        failed += 1
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : err
      // 首次请求即连接失败，代表 pix2real 未运行 —— 无需继续尝试
      if (firstRequest) {
        console.log('[P2V] connection failed (pix2real not running?):', errMsg)
        const result = {
          sent: 0,
          failed: fileIds.length,
          error: '无法连接 P2V，请确认 pix2real 正在运行'
        }
        console.log('[P2V] result:', result)
        return result
      }
      // 非首次的偶发失败：仅计入 failed 并继续
      console.log('[P2V] request failed for', filePath, ':', errMsg)
      failed += 1
    } finally {
      clearTimeout(t)
    }
  }

  const result = { sent, failed }
  console.log('[P2V] result:', result)
  return result
}
