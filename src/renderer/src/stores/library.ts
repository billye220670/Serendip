import { create } from 'zustand'

interface ScanProgress {
  phase: 'walking' | 'diffing' | 'inserting' | 'done'
  scanned: number
  total: number
  added: number
  removed: number
  updated: number
  currentPath?: string
}

/** 主区域当前视图 */
export type View =
  | { kind: 'explore' }
  | { kind: 'category'; id: number }

interface LibraryState {
  rootPath: string | null
  isScanning: boolean
  scanProgress: ScanProgress | null
  stats: { totalFiles: number; totalFolders: number; liked: number } | null
  view: View
  /** 递增计数，用于通知当前分类视图重新拉取（如跨视图"移动到此"后） */
  categoryRefreshNonce: number

  setRootPath: (path: string | null) => void
  setView: (view: View) => void
  startScan: (path: string) => Promise<void>
  updateProgress: (progress: ScanProgress) => void
  loadCurrentRoot: () => Promise<void>
  loadStats: () => Promise<void>
  /** 触发当前分类视图重载 */
  bumpCategoryRefresh: () => void
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  rootPath: null,
  isScanning: false,
  scanProgress: null,
  stats: null,
  view: { kind: 'explore' },
  categoryRefreshNonce: 0,

  setRootPath: (path) => set({ rootPath: path }),
  setView: (view) => set({ view }),
  bumpCategoryRefresh: () =>
    set((s) => ({ categoryRefreshNonce: s.categoryRefreshNonce + 1 })),

  startScan: async (path: string) => {
    set({ isScanning: true, scanProgress: null })

    // 订阅进度
    const unsubscribe = window.api.onScanProgress((progress) => {
      get().updateProgress(progress)
    })

    try {
      const result = await window.api.scanRoot(path)
      set({
        rootPath: path,
        scanProgress: result,
        isScanning: false
      })
      // 扫描完成后加载统计
      await get().loadStats()
    } catch (error) {
      console.error('Scan failed:', error)
      set({ isScanning: false })
    } finally {
      unsubscribe()
    }
  },

  updateProgress: (progress) => {
    set({ scanProgress: progress })
  },

  loadCurrentRoot: async () => {
    const root = await window.api.getCurrentRoot()
    set({ rootPath: root })
    if (root) {
      await get().loadStats()
    }
  },

  loadStats: async () => {
    const stats = await window.api.getStats()
    set({ stats })
  }
}))
