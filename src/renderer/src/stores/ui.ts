import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type Theme = 'light' | 'dark'
type ExploreMode = 'prefer' | 'balanced' | 'explore'

interface UIState {
  theme: Theme
  exploreMode: ExploreMode
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
  setExploreMode: (mode: ExploreMode) => void
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      theme: 'light',
      exploreMode: 'balanced',

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
