/**
 * 收藏分类业务逻辑
 *
 * - categories 表存分类元数据（唯一名 + position 用于拖拽排序）
 * - category_items 表存分类与媒体文件的多对多关联
 * - 删除分类用 SQLite ON DELETE CASCADE 自动清掉关联（schema 已定义）
 */

import { getDatabase } from '../db'
import type { MediaItem } from '../recommender'

export interface Category {
  id: number
  name: string
  position: number
  itemCount: number
  createdAt: number
}

/** 列出所有分类，按 position 升序，附带每个分类的项目数 */
export function listCategories(): Category[] {
  const db = getDatabase()
  const rows = db
    .prepare(
      `SELECT c.id, c.name, c.position, c.created_at as createdAt,
              (SELECT COUNT(*) FROM category_items ci WHERE ci.category_id = c.id) as itemCount
       FROM categories c
       ORDER BY c.position ASC, c.id ASC`
    )
    .all() as Category[]
  return rows
}

/** 创建分类，返回新分类 id；若名称重复抛错 */
export function createCategory(name: string): number {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('分类名不能为空')
  if (trimmed.length > 60) throw new Error('分类名过长')

  const db = getDatabase()
  // 找到当前最大 position，新分类排到最末
  const max = db.prepare('SELECT IFNULL(MAX(position), 0) as m FROM categories').get() as {
    m: number
  }
  try {
    const result = db
      .prepare('INSERT INTO categories (name, position) VALUES (?, ?)')
      .run(trimmed, max.m + 1)
    return Number(result.lastInsertRowid)
  } catch (err) {
    const e = err as { code?: string; message?: string }
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      throw new Error('分类名已存在')
    }
    throw err
  }
}

/** 重命名分类 */
export function renameCategory(id: number, newName: string): void {
  const trimmed = newName.trim()
  if (!trimmed) throw new Error('分类名不能为空')
  if (trimmed.length > 60) throw new Error('分类名过长')

  const db = getDatabase()
  try {
    const result = db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(trimmed, id)
    if (result.changes === 0) throw new Error('分类不存在')
  } catch (err) {
    const e = err as { code?: string; message?: string }
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      throw new Error('分类名已存在')
    }
    throw err
  }
}

/** 删除分类（关联通过 ON DELETE CASCADE 自动清除） */
export function deleteCategory(id: number): void {
  const db = getDatabase()
  db.prepare('DELETE FROM categories WHERE id = ?').run(id)
}

/** 重排分类：按传入的 id 顺序重写 position（事务） */
export function reorderCategories(orderedIds: number[]): void {
  const db = getDatabase()
  const update = db.prepare('UPDATE categories SET position = ? WHERE id = ?')
  const txn = db.transaction((ids: number[]) => {
    for (let i = 0; i < ids.length; i++) {
      update.run(i + 1, ids[i])
    }
  })
  txn(orderedIds)
}

/** 取分类下的所有媒体项（按加入时间倒序）。失效项不返回。 */
export function getCategoryItems(categoryId: number): MediaItem[] {
  const db = getDatabase()
  const rows = db
    .prepare(
      `SELECT m.id, m.path, m.folder_path, m.type, m.width, m.height, m.duration_ms,
              m.liked, m.disliked
       FROM category_items ci
       JOIN media_files m ON m.id = ci.file_id
       WHERE ci.category_id = ?
         AND m.unavailable = 0
       ORDER BY ci.added_at DESC`
    )
    .all(categoryId) as MediaItem[]
  return rows
}

/**
 * 把多个媒体项加入分类（去重：已存在的会被 INSERT OR IGNORE 跳过）。
 * 返回真正新增的数量。
 */
export function addItemsToCategory(categoryId: number, fileIds: number[]): number {
  if (fileIds.length === 0) return 0
  const db = getDatabase()
  // 校验分类存在
  const cat = db.prepare('SELECT id FROM categories WHERE id = ?').get(categoryId)
  if (!cat) throw new Error('分类不存在')

  const insert = db.prepare(
    'INSERT OR IGNORE INTO category_items (category_id, file_id) VALUES (?, ?)'
  )
  let added = 0
  const txn = db.transaction((ids: number[]) => {
    for (const id of ids) {
      const r = insert.run(categoryId, id)
      if (r.changes > 0) added++
    }
  })
  txn(fileIds)
  return added
}

/** 从分类中移除一个媒体项 */
export function removeItemFromCategory(categoryId: number, fileId: number): void {
  const db = getDatabase()
  db.prepare('DELETE FROM category_items WHERE category_id = ? AND file_id = ?').run(
    categoryId,
    fileId
  )
}

/** 批量从分类移除媒体项（事务） */
export function removeItemsFromCategory(categoryId: number, fileIds: number[]): void {
  if (fileIds.length === 0) return
  const db = getDatabase()
  const del = db.prepare('DELETE FROM category_items WHERE category_id = ? AND file_id = ?')
  const txn = db.transaction((ids: number[]) => {
    for (const id of ids) del.run(categoryId, id)
  })
  txn(fileIds)
}
