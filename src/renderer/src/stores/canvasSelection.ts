import { create } from 'zustand'
import type { CanvasItem } from '../../../main/canvases'

interface CanvasSelectionState {
  /** 选中的 canvas_item.id（不是 file_id，同文件可在画布多份） */
  selected: Set<number>
  /** Shift-range 锚点 */
  anchor: number | null

  toggle: (itemId: number) => void
  select: (itemIds: number[]) => void
  selectRange: (targetIdx: number, items: CanvasItem[]) => void
  selectAll: (items: CanvasItem[]) => void
  clear: () => void
}

export const useCanvasSelectionStore = create<CanvasSelectionState>((set, get) => ({
  selected: new Set(),
  anchor: null,

  toggle: (itemId) => {
    const prev = get().selected
    const next = new Set(prev)
    if (next.has(itemId)) {
      next.delete(itemId)
    } else {
      next.add(itemId)
    }
    set({ selected: next, anchor: itemId })
  },

  select: (itemIds) => {
    set({ selected: new Set(itemIds), anchor: itemIds[itemIds.length - 1] ?? null })
  },

  selectRange: (targetIdx, items) => {
    const { anchor, selected } = get()
    const anchorIdx = anchor !== null ? items.findIndex((it) => it.id === anchor) : -1
    if (anchorIdx < 0) {
      // 没有锚点：仅选中目标
      const id = items[targetIdx]?.id
      if (id !== undefined) set({ selected: new Set([id]), anchor: id })
      return
    }
    const from = Math.min(anchorIdx, targetIdx)
    const to = Math.max(anchorIdx, targetIdx)
    const next = new Set(selected)
    for (let i = from; i <= to; i++) {
      if (items[i]) next.add(items[i].id)
    }
    set({ selected: next })
  },

  selectAll: (items) => {
    set({ selected: new Set(items.map((it) => it.id)), anchor: null })
  },

  clear: () => {
    set({ selected: new Set(), anchor: null })
  },
}))
