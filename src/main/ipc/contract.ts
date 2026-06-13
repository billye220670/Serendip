/**
 * IPC 通信契约 — 主进程与渲染进程共享的类型定义
 */

import type { ScanProgress } from '../scanner'
import type { MediaItem, ExploreMode } from '../recommender'
import type { Category } from '../categories'

// 主进程暴露给渲染进程的 API
export interface SerendipAPI {
  // ===== 库管理 =====
  selectRootDirectory(): Promise<string | null>
  scanRoot(rootPath: string): Promise<ScanProgress>
  getCurrentRoot(): Promise<string | null>
  getStats(): Promise<{ totalFiles: number; totalFolders: number; liked: number }>

  // ===== 推荐与浏览 =====
  getRecommendations(count: number, mode: ExploreMode, onlyUnrated?: boolean): Promise<MediaItem[]>
  setLiked(fileId: number, liked: boolean): Promise<void>
  setDisliked(fileId: number, disliked: boolean): Promise<void>
  /** 批量设置喜欢（多选模式） */
  setLikedBatch(fileIds: number[], liked: boolean): Promise<void>
  /** 批量设置不感兴趣（多选模式） */
  setDislikedBatch(fileIds: number[], disliked: boolean): Promise<void>
  /** 列出所有 liked=1 且未失效的文件（喜欢视图使用，按 id 倒序 ≈ 最近入库优先） */
  listLiked(): Promise<MediaItem[]>
  markUnavailable(fileId: number, reason: string): Promise<void>
  revealInFolder(fileId: number): Promise<void>

  // ===== 收藏分类 =====
  listCategories(): Promise<Category[]>
  createCategory(name: string): Promise<number>
  renameCategory(id: number, newName: string): Promise<void>
  deleteCategory(id: number): Promise<void>
  reorderCategories(orderedIds: number[]): Promise<void>
  getCategoryItems(categoryId: number): Promise<MediaItem[]>
  addItemsToCategory(categoryId: number, fileIds: number[]): Promise<number>
  removeItemFromCategory(categoryId: number, fileId: number): Promise<void>
  /** 批量从分类移除（多选模式） */
  removeItemsFromCategory(categoryId: number, fileIds: number[]): Promise<void>
  /** 返回文件所属的分类 id 列表（评审视图胶囊高亮用） */
  getFileCategoryIds(fileId: number): Promise<number[]>

  // ===== 进度订阅 =====
  onScanProgress(callback: (progress: ScanProgress) => void): () => void
}

declare global {
  interface Window {
    api: SerendipAPI
    electron: import('@electron-toolkit/preload').ElectronAPI
  }
}

// IPC 通道名
export const IPC = {
  SELECT_ROOT: 'serendip:selectRoot',
  SCAN_ROOT: 'serendip:scanRoot',
  GET_CURRENT_ROOT: 'serendip:getCurrentRoot',
  GET_STATS: 'serendip:getStats',
  SCAN_PROGRESS: 'serendip:scanProgress',
  GET_RECOMMENDATIONS: 'serendip:getRecommendations',
  SET_LIKED: 'serendip:setLiked',
  SET_DISLIKED: 'serendip:setDisliked',
  SET_LIKED_BATCH: 'serendip:setLikedBatch',
  SET_DISLIKED_BATCH: 'serendip:setDislikedBatch',
  LIST_LIKED: 'serendip:listLiked',
  MARK_UNAVAILABLE: 'serendip:markUnavailable',
  REVEAL_IN_FOLDER: 'serendip:revealInFolder',
  LIST_CATEGORIES: 'serendip:listCategories',
  CREATE_CATEGORY: 'serendip:createCategory',
  RENAME_CATEGORY: 'serendip:renameCategory',
  DELETE_CATEGORY: 'serendip:deleteCategory',
  REORDER_CATEGORIES: 'serendip:reorderCategories',
  GET_CATEGORY_ITEMS: 'serendip:getCategoryItems',
  ADD_ITEMS_TO_CATEGORY: 'serendip:addItemsToCategory',
  REMOVE_ITEM_FROM_CATEGORY: 'serendip:removeItemFromCategory',
  REMOVE_ITEMS_FROM_CATEGORY: 'serendip:removeItemsFromCategory',
  GET_FILE_CATEGORY_IDS: 'serendip:getFileCategoryIds'
} as const
