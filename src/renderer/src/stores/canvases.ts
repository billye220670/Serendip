import { create } from 'zustand'
import type { Canvas } from '../../../main/canvases'
import type { CanvasItemInput } from '../../../main/canvases'

interface CanvasesState {
  canvases: Canvas[]
  loaded: boolean

  load: () => Promise<void>
  create: (name: string) => Promise<number>
  rename: (id: number, newName: string) => Promise<void>
  remove: (id: number) => Promise<void>
  reorder: (orderedIds: number[]) => Promise<void>
  addItems: (canvasId: number, items: CanvasItemInput[]) => Promise<number[]>
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

  addItems: async (canvasId: number, items: CanvasItemInput[]) => {
    const newIds = await window.api.addItemsToCanvas(canvasId, items)
    if (newIds.length > 0) {
      set((s) => ({
        canvases: s.canvases.map((c) =>
          c.id === canvasId ? { ...c, itemCount: c.itemCount + newIds.length } : c
        )
      }))
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
  }
}))
