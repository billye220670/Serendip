/**
 * 画布（Canvas）业务逻辑
 *
 * - canvases 表存画布元数据（唯一名 + position 用于拖拽排序 + viewport 持久化）
 * - canvas_items 表存画布与媒体文件的关联（无 UNIQUE 约束，同文件可多次加入同一画布）
 * - 删除画布用 SQLite ON DELETE CASCADE 自动清掉关联
 */

import { getDatabase } from '../db'

export interface Canvas {
  id: number
  name: string
  position: number
  viewportX: number
  viewportY: number
  viewportScale: number
  itemCount: number
  createdAt: number
}

export interface CanvasItem {
  id: number
  canvasId: number
  fileId: number
  fileType: 'image' | 'video'
  filePath: string
  fileWidth: number | null
  fileHeight: number | null
  fileLiked: number
  fileDisliked: number
  x: number
  y: number
  w: number
  h: number
  rotation: number
  z: number
  clipPolygon: string | null
  addedAt: number
}

export interface CanvasItemInput {
  fileId: number
  x: number
  y: number
  w: number
  h: number
  z: number
  rotation?: number
}

/** 完整变换输入：w/h/rotation/clipPolygon 原样写入（复制/粘贴/再制用，保真不重算尺寸） */
export interface CanvasItemFullInput {
  fileId: number
  x: number
  y: number
  w: number
  h: number
  z: number
  rotation: number
  clipPolygon: string | null
}

export interface CanvasItemPatch {
  id: number
  x?: number
  y?: number
  w?: number
  h?: number
  rotation?: number
  z?: number
  clipPolygon?: string | null
}

/** 列出所有画布，按 position 升序，附带每个画布的项目数 */
export function listCanvases(): Canvas[] {
  const db = getDatabase()
  const rows = db
    .prepare(
      `SELECT c.id, c.name, c.position,
              c.viewport_x as viewportX, c.viewport_y as viewportY,
              c.viewport_scale as viewportScale,
              c.created_at as createdAt,
              (SELECT COUNT(*) FROM canvas_items ci WHERE ci.canvas_id = c.id) as itemCount
       FROM canvases c
       ORDER BY c.position ASC, c.id ASC`
    )
    .all() as Canvas[]
  return rows
}

/** 创建画布，返回新画布 id；若名称重复抛错 */
export function createCanvas(name: string): number {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('画布名不能为空')
  if (trimmed.length > 60) throw new Error('画布名过长')

  const db = getDatabase()
  const max = db.prepare('SELECT IFNULL(MAX(position), 0) as m FROM canvases').get() as { m: number }
  try {
    const result = db
      .prepare('INSERT INTO canvases (name, position) VALUES (?, ?)')
      .run(trimmed, max.m + 1)
    return Number(result.lastInsertRowid)
  } catch (err) {
    const e = err as { code?: string }
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      throw new Error('画布名已存在')
    }
    throw err
  }
}

/** 重命名画布 */
export function renameCanvas(id: number, newName: string): void {
  const trimmed = newName.trim()
  if (!trimmed) throw new Error('画布名不能为空')
  if (trimmed.length > 60) throw new Error('画布名过长')

  const db = getDatabase()
  try {
    const result = db.prepare('UPDATE canvases SET name = ? WHERE id = ?').run(trimmed, id)
    if (result.changes === 0) throw new Error('画布不存在')
  } catch (err) {
    const e = err as { code?: string }
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      throw new Error('画布名已存在')
    }
    throw err
  }
}

/** 删除画布（关联通过 ON DELETE CASCADE 自动清除） */
export function deleteCanvas(id: number): void {
  const db = getDatabase()
  db.prepare('DELETE FROM canvases WHERE id = ?').run(id)
}

/** 重排画布：按传入的 id 顺序重写 position（事务） */
export function reorderCanvases(orderedIds: number[]): void {
  const db = getDatabase()
  const update = db.prepare('UPDATE canvases SET position = ? WHERE id = ?')
  const txn = db.transaction((ids: number[]) => {
    for (let i = 0; i < ids.length; i++) {
      update.run(i + 1, ids[i])
    }
  })
  txn(orderedIds)
}

/** 取画布下的所有媒体项（按加入时间倒序）。 */
export function getCanvasItems(canvasId: number): CanvasItem[] {
  const db = getDatabase()
  const rows = db
    .prepare(
      `SELECT ci.id, ci.canvas_id as canvasId, ci.file_id as fileId,
              m.type as fileType, m.path as filePath,
              m.width as fileWidth, m.height as fileHeight,
              m.liked as fileLiked, m.disliked as fileDisliked,
              ci.x, ci.y, ci.w, ci.h, ci.rotation, ci.z,
              ci.clip_polygon as clipPolygon,
              ci.added_at as addedAt
       FROM canvas_items ci
       JOIN media_files m ON m.id = ci.file_id
       WHERE ci.canvas_id = ?
       ORDER BY ci.z ASC, ci.added_at ASC`
    )
    .all(canvasId) as CanvasItem[]
  return rows
}

// 图片在画布上的目标显示宽度（世界像素）
const CANVAS_DISPLAY_W = 300

/**
 * 把多个媒体项加入画布（允许同文件多次加入，不去重）。
 * 返回新建的 canvas_item id 列表。
 * w/h 以文件实际宽高比推算（目标宽 CANVAS_DISPLAY_W），未知时沿用 input 传入值。
 */
export function addItemsToCanvas(canvasId: number, items: CanvasItemInput[]): number[] {
  if (items.length === 0) return []
  const db = getDatabase()

  const canvas = db.prepare('SELECT id FROM canvases WHERE id = ?').get(canvasId)
  if (!canvas) throw new Error('画布不存在')

  const getDims = db.prepare<[number], { width: number | null; height: number | null }>(
    'SELECT width, height FROM media_files WHERE id = ?'
  )
  const insert = db.prepare(
    'INSERT INTO canvas_items (canvas_id, file_id, x, y, w, h, z, rotation) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  )
  const ids: number[] = []
  const txn = db.transaction((inputs: CanvasItemInput[]) => {
    for (const item of inputs) {
      const dims = getDims.get(item.fileId)
      let w = item.w
      let h = item.h
      if (dims?.width && dims.height && dims.width > 0 && dims.height > 0) {
        w = CANVAS_DISPLAY_W
        h = Math.round(CANVAS_DISPLAY_W * (dims.height / dims.width))
      }
      const r = insert.run(canvasId, item.fileId, item.x, item.y, w, h, item.z, item.rotation ?? 0)
      ids.push(Number(r.lastInsertRowid))
    }
  })
  txn(items)
  return ids
}

/**
 * 把多个媒体项按给定的完整变换原样插入画布（含 w/h/rotation/clipPolygon）。
 * 与 addItemsToCanvas 不同：不依据文件原始宽高重算尺寸，用于复制/粘贴/再制保真。
 * 返回新建的 canvas_item id 列表。
 */
export function addItemsToCanvasRaw(canvasId: number, items: CanvasItemFullInput[]): number[] {
  if (items.length === 0) return []
  const db = getDatabase()

  const canvas = db.prepare('SELECT id FROM canvases WHERE id = ?').get(canvasId)
  if (!canvas) throw new Error('画布不存在')

  const insert = db.prepare(
    'INSERT INTO canvas_items (canvas_id, file_id, x, y, w, h, z, rotation, clip_polygon) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )
  const ids: number[] = []
  const txn = db.transaction((inputs: CanvasItemFullInput[]) => {
    for (const item of inputs) {
      const r = insert.run(
        canvasId,
        item.fileId,
        item.x,
        item.y,
        item.w,
        item.h,
        item.z,
        item.rotation,
        item.clipPolygon
      )
      ids.push(Number(r.lastInsertRowid))
    }
  })
  txn(items)
  return ids
}

/** 批量从画布移除项目（按 canvas_item.id，事务） */
export function removeItemsFromCanvas(canvasId: number, itemIds: number[]): void {
  if (itemIds.length === 0) return
  const db = getDatabase()
  const del = db.prepare('DELETE FROM canvas_items WHERE id = ? AND canvas_id = ?')
  const txn = db.transaction((ids: number[]) => {
    for (const id of ids) del.run(id, canvasId)
  })
  txn(itemIds)
}

/** 更新单个画布项目的变换属性 */
export function updateCanvasItem(itemId: number, patch: Omit<CanvasItemPatch, 'id'>): void {
  const db = getDatabase()
  const fields: string[] = []
  const values: unknown[] = []

  if (patch.x !== undefined) { fields.push('x = ?'); values.push(patch.x) }
  if (patch.y !== undefined) { fields.push('y = ?'); values.push(patch.y) }
  if (patch.w !== undefined) { fields.push('w = ?'); values.push(patch.w) }
  if (patch.h !== undefined) { fields.push('h = ?'); values.push(patch.h) }
  if (patch.rotation !== undefined) { fields.push('rotation = ?'); values.push(patch.rotation) }
  if (patch.z !== undefined) { fields.push('z = ?'); values.push(patch.z) }
  if ('clipPolygon' in patch) { fields.push('clip_polygon = ?'); values.push(patch.clipPolygon) }

  if (fields.length === 0) return
  values.push(itemId)
  db.prepare(`UPDATE canvas_items SET ${fields.join(', ')} WHERE id = ?`).run(...values)
}

/** 批量更新画布项目（事务） */
export function updateCanvasItems(patches: CanvasItemPatch[]): void {
  if (patches.length === 0) return
  const db = getDatabase()
  const txn = db.transaction((items: CanvasItemPatch[]) => {
    for (const patch of items) {
      const { id, ...rest } = patch
      updateCanvasItem(id, rest)
    }
  })
  txn(patches)
}

/** 更新画布视口（pan/zoom 持久化） */
export function updateCanvasViewport(canvasId: number, x: number, y: number, scale: number): void {
  const db = getDatabase()
  db.prepare(
    'UPDATE canvases SET viewport_x = ?, viewport_y = ?, viewport_scale = ? WHERE id = ?'
  ).run(x, y, scale, canvasId)
}

/** 返回某个文件所在的所有画布 id（用于 picker 高亮） */
export function getFileCanvasIds(fileId: number): number[] {
  const db = getDatabase()
  const rows = db
    .prepare('SELECT DISTINCT canvas_id FROM canvas_items WHERE file_id = ?')
    .all(fileId) as Array<{ canvas_id: number }>
  return rows.map((r) => r.canvas_id)
}
