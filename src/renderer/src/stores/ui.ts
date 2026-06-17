import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type Theme = 'light' | 'dark'
type ExploreMode = 'prefer' | 'balanced' | 'explore'
/** 瀑布流缩略图尺寸档（影响列数）— 见 lib/grid.ts */
export type GridSize = 'small' | 'medium' | 'large'

interface UIState {
  theme: Theme
  exploreMode: ExploreMode
  gridSize: GridSize
  sidebarCollapsed: boolean
  /** 详情页 d 推荐面板的开关偏好（持久化跨会话记忆） */
  detailPanelOpen: boolean
  /** 侧栏分类组折叠状态 */
  categoriesGroupOpen: boolean
  /** 侧栏画布组折叠状态（首次默认收起） */
  canvasesGroupOpen: boolean
  /** 画布全部视频静止（图片化）开关 */
  canvasFreezeVideos: boolean
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
  setExploreMode: (mode: ExploreMode) => void
  /** 直接设定瀑布流缩略图档位 */
  setGridSize: (size: GridSize) => void
  /** 循环切换 小 → 中 → 大 → 小 */
  cycleGridSize: () => void
  toggleSidebar: () => void
  toggleDetailPanel: () => void
  toggleCategoriesGroup: () => void
  toggleCanvasesGroup: () => void
  toggleFreezeVideos: () => void
}

const GRID_ORDER: GridSize[] = ['small', 'medium', 'large']

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      theme: 'light',
      exploreMode: 'balanced',
      gridSize: 'medium',
      sidebarCollapsed: false,
      detailPanelOpen: false,
      categoriesGroupOpen: true,
      canvasesGroupOpen: false,
      canvasFreezeVideos: false,

      setTheme: (theme) => {
        set({ theme })
        document.documentElement.setAttribute('data-theme', theme)
      },

      toggleTheme: () => set((state) => {
        const newTheme = state.theme === 'light' ? 'dark' : 'light'
        document.documentElement.setAttribute('data-theme', newTheme)
        return { theme: newTheme }
      }),

      setExploreMode: (exploreMode) => set({ exploreMode }),

      setGridSize: (gridSize) => set({ gridSize }),

      cycleGridSize: () =>
        set((state) => {
          const i = GRID_ORDER.indexOf(state.gridSize)
          return { gridSize: GRID_ORDER[(i + 1) % GRID_ORDER.length] }
        }),

      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

      toggleDetailPanel: () => set((state) => ({ detailPanelOpen: !state.detailPanelOpen })),

      toggleCategoriesGroup: () => set((state) => ({ categoriesGroupOpen: !state.categoriesGroupOpen })),

      toggleCanvasesGroup: () => set((state) => ({ canvasesGroupOpen: !state.canvasesGroupOpen })),

      toggleFreezeVideos: () => set((state) => ({ canvasFreezeVideos: !state.canvasFreezeVideos })),
    }),
    {
      name: 'serendip-ui',
      onRehydrateStorage: () => (state) => {
        // 恢复主题到 DOM
        if (state?.theme) {
          document.documentElement.setAttribute('data-theme', state.theme)
        }
      },
    }
  )
)
