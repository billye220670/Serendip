import { create } from 'zustand'
import type { Canvas } from '../../../main/canvases'
import { useCanvasItemsStore } from './canvasItems'
import { computeWaterfallPositions } from '../lib/canvasMath'

interface CanvasesState {
  canvases: Canvas[]
  loaded: boolean

  load: () => Promise<void>
  create: (name: string) => Promise<number>
  rename: (id: number, newName: string) => Promise<void>
  remove: (id: number) => Promise<void>
  reorder: (orderedIds: number[]) => Promise<void>
  /** 把 fileIds 加入画布，自动计算瀑布式布局位置，返回新 canvas_item id 列表 */
  addItems: (canvasId: number, fileIds: number[]) => Promise<number[]>
  removeItems: (canvasId: number, itemIds: number[]) => Promise<void>
}

export const useCanvasesStore = create<CanvasesState>((set, get) => ({
  canvases: [],
  loaded: false,

  load: async () => {
    const list = await window.api.listCanvases()
    set({ canvases: list, loaded: true })
  },

  create: async (name: string) => {
    const id = await window.api.createCanvas(name)
    await get().load()
    return id
  },

  rename: async (id: number, newName: string) => {
    await window.api.renameCanvas(id, newName)
    await get().load()
  },

  remove: async (id: number) => {
    await window.api.deleteCanvas(id)
    await get().load()
  },

  reorder: async (orderedIds: number[]) => {
    set((s) => {
      const map = new Map(s.canvases.map((c) => [c.id, c]))
      const next: Canvas[] = []
      orderedIds.forEach((id, i) => {
        const c = map.get(id)
        if (c) next.push({ ...c, position: i + 1 })
      })
      return { canvases: next }
    })
    await window.api.reorderCanvases(orderedIds)
  },

  addItems: async (canvasId: number, fileIds: number[]) => {
    if (fileIds.length === 0) return []
    // 每次从 DB 拿最新元素，避免连续调用时因 bump() 异步而读到旧 state
    const existing = await window.api.getCanvasItems(canvasId)
    const inputs = computeWaterfallPositions(fileIds, existing)

    const newIds = await window.api.addItemsToCanvas(canvasId, inputs)
    if (newIds.length > 0) {
      set((s) => ({
        canvases: s.canvases.map((c) =>
          c.id === canvasId ? { ...c, itemCount: c.itemCount + newIds.length } : c
        )
      }))
      const itemsStore = useCanvasItemsStore.getState()
      if (itemsStore.canvasId === canvasId) itemsStore.bump()
    }
    return newIds
  },

  removeItems: async (canvasId: number, itemIds: number[]) => {
    if (itemIds.length === 0) return
    await window.api.removeItemsFromCanvas(canvasId, itemIds)
    set((s) => ({
      canvases: s.canvases.map((c) =>
        c.id === canvasId
          ? { ...c, itemCount: Math.max(0, c.itemCount - itemIds.length) }
          : c
      )
    }))
    const itemsStore = useCanvasItemsStore.getState()
    if (itemsStore.canvasId === canvasId) itemsStore.bump()
  }
}))
