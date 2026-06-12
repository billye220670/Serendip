/**
 * IPC 通信契约 — 主进程与渲染进程共享的类型定义
 */

import type { ScanProgress } from '../scanner'
import type { MediaItem, ExploreMode } from '../recommender'

// 主进程暴露给渲染进程的 API
export interface SerendipAPI {
  // ===== 库管理 =====
  selectRootDirectory(): Promise<string | null>
  scanRoot(rootPath: string): Promise<ScanProgress>
  getCurrentRoot(): Promise<string | null>
  getStats(): Promise<{ totalFiles: number; totalFolders: number; liked: number }>

  // ===== 推荐与浏览 =====
  getRecommendations(count: number, mode: ExploreMode): Promise<MediaItem[]>
  setLiked(fileId: number, liked: boolean): Promise<void>
  setDisliked(fileId: number, disliked: boolean): Promise<void>
  markUnavailable(fileId: number, reason: string): Promise<void>
  revealInFolder(fileId: number): Promise<void>

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
  MARK_UNAVAILABLE: 'serendip:markUnavailable',
  REVEAL_IN_FOLDER: 'serendip:revealInFolder'
} as const
