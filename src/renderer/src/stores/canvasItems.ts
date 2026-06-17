import { create } from 'zustand'
import type { CanvasItem, CanvasItemPatch } from '../../../main/canvases'

interface CanvasItemsState {
  canvasId: number | null
  items: CanvasItem[]
  loading: boolean

  load: (canvasId: number) => Promise<void>
  unload: () => void
  /** 外部添加/删除 items 后调用，触发重新拉取 */
  bump: () => void
  /** 乐观更新 + 250ms debounce flush 到 DB */
  updateItems: (patches: CanvasItemPatch[]) => void
  removeItems: (canvasId: number, itemIds: number[]) => Promise<void>
}

// debounce flush 到 DB
let flushTimer: ReturnType<typeof setTimeout> | null = null
let pendingPatches: CanvasItemPatch[] = []

function scheduleFlush(): void {
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(async () => {
    flushTimer = null
    const patches = pendingPatches
    pendingPatches = []
    if (patches.length > 0) {
      await window.api.updateCanvasItems(patches)
    }
  }, 250)
}

export const useCanvasItemsStore = create<CanvasItemsState>((set, get) => ({
  canvasId: null,
  items: [],
  loading: false,

  load: async (canvasId: number) => {
    set({ loading: true, canvasId })
    try {
      const items = await window.api.getCanvasItems(canvasId)
      set((s) => {
        if (s.canvasId !== canvasId) return {}
        return { items, loading: false }
      })
    } catch {
      set((s) => {
        if (s.canvasId !== canvasId) return {}
        return { loading: false }
      })
    }
  },

  unload: () => {
    set({ canvasId: null, items: [], loading: false })
  },

  bump: () => {
    const { canvasId, load } = get()
    if (canvasId !== null) {
      void load(canvasId)
    }
  },

  updateItems: (patches: CanvasItemPatch[]) => {
    set((s) => {
      const map = new Map(patches.map((p) => [p.id, p]))
      return {
        items: s.items.map((item) => {
          const patch = map.get(item.id)
          return patch ? { ...item, ...patch } : item
        })
      }
    })
    for (const patch of patches) {
      const idx = pendingPatches.findIndex((p) => p.id === patch.id)
      if (idx >= 0) {
        pendingPatches[idx] = { ...pendingPatches[idx], ...patch }
      } else {
        pendingPatches.push(patch)
      }
    }
    scheduleFlush()
  },

  removeItems: async (canvasId: number, itemIds: number[]) => {
    await window.api.removeItemsFromCanvas(canvasId, itemIds)
    set((s) => ({
      items: s.items.filter((item) => !itemIds.includes(item.id))
    }))
  }
}))
