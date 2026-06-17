import { create } from 'zustand'

interface CurrentCanvasState {
  currentCanvasId: number | null
  setCurrent: (id: number | null) => void
}

export const useCurrentCanvasStore = create<CurrentCanvasState>((set) => ({
  currentCanvasId: null,
  setCurrent: (id) => set({ currentCanvasId: id })
}))
