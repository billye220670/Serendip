import { create } from 'zustand'
import type { MediaItem } from '../../../main/recommender'

interface DetailState {
  isOpen: boolean
  currentItem: MediaItem | null
  open: (item: MediaItem) => void
  close: () => void
}

export const useDetailStore = create<DetailState>((set) => ({
  isOpen: false,
  currentItem: null,
  open: (item) => set({ isOpen: true, currentItem: item }),
  close: () => set({ isOpen: false })
}))
