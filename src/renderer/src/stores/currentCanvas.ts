import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface CurrentCanvasState {
  currentCanvasId: number | null
  setCurrent: (id: number | null) => void
}

export const useCurrentCanvasStore = create<CurrentCanvasState>()(
  persist(
    (set) => ({
      currentCanvasId: null,
      setCurrent: (id) => set({ currentCanvasId: id })
    }),
    { name: 'serendip-current-canvas' }
  )
)
