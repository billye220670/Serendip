import { create } from 'zustand'
import type { Canvas, CanvasItemFullInput } from '../../../main/canvases'
import { useCanvasItemsStore } from './canvasItems'
import { layoutJustifiedRows, findBlockPlacement, GRID_GAP } from '../lib/canvasMath'

interface CanvasesState {
  canvases: Canvas[]
  loaded: boolean

  load: () => Promise<void>
  create: (name: string) => Promise<number>
  rename: (id: number, newName: string) => Promise<void>
  remove: (id: number) => Promise<void>
  reorder: (orderedIds: number[]) => Promise<void>
  /** 把 fileIds 加入画布，自动排成等高行网格（不打乱已有元素），返回新 canvas_item id 列表 */
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
    // 取新图真实宽高比（未知回退 4:3），按 fileIds 顺序排等高行网格
    const dims = await window.api.getMediaDimensions(fileIds)
    const dimMap = new Map(dims.map((d) => [d.id, d]))
    const aspects = fileIds.map((id) => {
      const d = dimMap.get(id)
      return d?.width && d?.height && d.width > 0 && d.height > 0 ? d.width / d.height : 4 / 3
    })

    const { positions, blockW, blockH } = layoutJustifiedRows(aspects)
    // 空画布居中原点；非空则在离现有内容最近的空白处放下整块（不动已有元素）
    const anchor =
      existing.length === 0 ? { x: 0, y: 0 } : findBlockPlacement(blockW, blockH, existing, GRID_GAP)
    const maxZ = existing.length > 0 ? Math.max(...existing.map((it) => it.z)) : 0

    // 用 Raw 写入：原样保存算好的 x/y/w/h，不让主进程按固定宽重算尺寸
    const inputs: CanvasItemFullInput[] = positions.map((p, i) => ({
      fileId: fileIds[i],
      x: p.x - blockW / 2 + anchor.x,
      y: p.y - blockH / 2 + anchor.y,
      w: p.w,
      h: p.h,
      z: maxZ + i + 1,
      rotation: 0,
      clipPolygon: null
    }))

    const newIds = await window.api.addItemsToCanvasRaw(canvasId, inputs)
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
