/**
 * IPC 通信契约 — 主进程与渲染进程共享的类型定义
 */

import type { ScanProgress } from '../scanner'
import type { MediaItem, ExploreMode } from '../recommender'
import type { Category } from '../categories'
import type { Canvas, CanvasItem, CanvasItemInput, CanvasItemFullInput, CanvasItemPatch } from '../canvases'

export type { Canvas, CanvasItem, CanvasItemInput, CanvasItemFullInput, CanvasItemPatch }

// 主进程暴露给渲染进程的 API
export interface SerendipAPI {
  // ===== 库管理 =====
  selectRootDirectory(): Promise<string | null>
  scanRoot(rootPath: string): Promise<ScanProgress>
  getCurrentRoot(): Promise<string | null>
  getStats(): Promise<{ totalFiles: number; totalFolders: number; liked: number }>

  // ===== 推荐与浏览 =====
  getRecommendations(count: number, mode: ExploreMode, onlyUnrated?: boolean, scopePath?: string): Promise<MediaItem[]>
  getHierarchicalRecommendations(folderPath: string, rootPath: string, count: number, mode: ExploreMode): Promise<MediaItem[]>
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
  /** 用系统默认应用打开文件 */
  openFile(fileId: number): Promise<void>
  /** 用系统资源管理器打开目录（不选中文件） */
  openFolder(folderPath: string): Promise<void>

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

  // ===== 画布 =====
  listCanvases(): Promise<Canvas[]>
  createCanvas(name: string): Promise<number>
  renameCanvas(id: number, newName: string): Promise<void>
  deleteCanvas(id: number): Promise<void>
  reorderCanvases(orderedIds: number[]): Promise<void>
  getCanvasItems(canvasId: number): Promise<CanvasItem[]>
  /** 批量取媒体文件的真实宽高（画布自动网格布局按比例排版用） */
  getMediaDimensions(fileIds: number[]): Promise<Array<{ id: number; width: number | null; height: number | null }>>
  addItemsToCanvas(canvasId: number, items: CanvasItemInput[]): Promise<number[]>
  addItemsToCanvasRaw(canvasId: number, items: CanvasItemFullInput[]): Promise<number[]>
  removeItemsFromCanvas(canvasId: number, itemIds: number[]): Promise<void>
  updateCanvasItem(itemId: number, patch: Omit<CanvasItemPatch, 'id'>): Promise<void>
  updateCanvasItems(patches: CanvasItemPatch[]): Promise<void>
  updateCanvasViewport(canvasId: number, x: number, y: number, scale: number): Promise<void>
  getFileCanvasIds(fileId: number): Promise<number[]>

  // ===== 进度订阅 =====
  onScanProgress(callback: (progress: ScanProgress) => void): () => void

  // ===== 插件：P2V（pix2real 图片推送） =====
  /** 将选中文件推送到 pix2real 指定工作流 Tab。返回成功/失败计数；连接失败时带 error */
  pluginP2VPush(
    fileIds: number[],
    workflowId: number,
    port?: number
  ): Promise<{ sent: number; failed: number; error?: string }>

  // ===== 窗口装饰（自绘标题栏） =====
  /** 设置 Windows Controls Overlay 的配色。theme 派生标准色；color/symbolColor 可直接覆盖（详情页用精确背景色） */
  setTitleBarOverlay(opts: { visible?: boolean; theme?: 'light' | 'dark'; color?: string; symbolColor?: string }): Promise<void>
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
  GET_HIERARCHICAL_RECOMMENDATIONS: 'serendip:getHierarchicalRecommendations',
  SET_LIKED: 'serendip:setLiked',
  SET_DISLIKED: 'serendip:setDisliked',
  SET_LIKED_BATCH: 'serendip:setLikedBatch',
  SET_DISLIKED_BATCH: 'serendip:setDislikedBatch',
  LIST_LIKED: 'serendip:listLiked',
  MARK_UNAVAILABLE: 'serendip:markUnavailable',
  REVEAL_IN_FOLDER: 'serendip:revealInFolder',
  OPEN_FILE: 'serendip:openFile',
  OPEN_FOLDER: 'serendip:openFolder',
  LIST_CATEGORIES: 'serendip:listCategories',
  CREATE_CATEGORY: 'serendip:createCategory',
  RENAME_CATEGORY: 'serendip:renameCategory',
  DELETE_CATEGORY: 'serendip:deleteCategory',
  REORDER_CATEGORIES: 'serendip:reorderCategories',
  GET_CATEGORY_ITEMS: 'serendip:getCategoryItems',
  ADD_ITEMS_TO_CATEGORY: 'serendip:addItemsToCategory',
  REMOVE_ITEM_FROM_CATEGORY: 'serendip:removeItemFromCategory',
  REMOVE_ITEMS_FROM_CATEGORY: 'serendip:removeItemsFromCategory',
  GET_FILE_CATEGORY_IDS: 'serendip:getFileCategoryIds',
  LIST_CANVASES: 'serendip:listCanvases',
  CREATE_CANVAS: 'serendip:createCanvas',
  RENAME_CANVAS: 'serendip:renameCanvas',
  DELETE_CANVAS: 'serendip:deleteCanvas',
  REORDER_CANVASES: 'serendip:reorderCanvases',
  GET_CANVAS_ITEMS: 'serendip:getCanvasItems',
  GET_MEDIA_DIMENSIONS: 'serendip:getMediaDimensions',
  ADD_ITEMS_TO_CANVAS: 'serendip:addItemsToCanvas',
  ADD_ITEMS_TO_CANVAS_RAW: 'serendip:addItemsToCanvasRaw',
  REMOVE_ITEMS_FROM_CANVAS: 'serendip:removeItemsFromCanvas',
  UPDATE_CANVAS_ITEM: 'serendip:updateCanvasItem',
  UPDATE_CANVAS_ITEMS: 'serendip:updateCanvasItems',
  UPDATE_CANVAS_VIEWPORT: 'serendip:updateCanvasViewport',
  GET_FILE_CANVAS_IDS: 'serendip:getFileCanvasIds',
  PLUGIN_P2V_PUSH: 'serendip:pluginP2VPush',
  SET_TITLE_BAR_OVERLAY: 'serendip:setTitleBarOverlay',
  FULLSCREEN_CHANGE: 'serendip:fullscreenChange',
  WINDOW_MOVE: 'serendip:windowMove'
} as const
