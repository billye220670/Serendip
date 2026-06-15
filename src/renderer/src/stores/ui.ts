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
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
  setExploreMode: (mode: ExploreMode) => void
  /** 循环切换 小 → 中 → 大 → 小 */
  cycleGridSize: () => void
  toggleSidebar: () => void
  toggleDetailPanel: () => void
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

      cycleGridSize: () =>
        set((state) => {
          const i = GRID_ORDER.indexOf(state.gridSize)
          return { gridSize: GRID_ORDER[(i + 1) % GRID_ORDER.length] }
        }),

      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

      toggleDetailPanel: () => set((state) => ({ detailPanelOpen: !state.detailPanelOpen })),
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
