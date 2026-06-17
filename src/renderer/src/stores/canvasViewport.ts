import { create } from 'zustand'
import type { Viewport } from '../lib/canvasMath'
import { DEFAULT_VIEWPORT } from '../lib/canvasMath'

interface CanvasViewportState {
  byId: Record<number, Viewport>
  /** 仅当该画布的视口尚未缓存时初始化（从 DB 读取的初始值） */
  initViewport: (canvasId: number, vp: Viewport) => void
  /** 更新视口并触发 debounce flush */
  setViewport: (canvasId: number, vp: Viewport) => void
}

// 按 canvasId 独立防抖，避免快速切画布时定时器串台
const flushTimers = new Map<number, ReturnType<typeof setTimeout>>()

function scheduleFlush(canvasId: number, vp: Viewport): void {
  const existing = flushTimers.get(canvasId)
  if (existing) clearTimeout(existing)
  const timer = setTimeout(() => {
    flushTimers.delete(canvasId)
    void window.api.updateCanvasViewport(canvasId, vp.x, vp.y, vp.scale)
  }, 500)
  flushTimers.set(canvasId, timer)
}

/** 立即 flush（unmount 时调用，避免最后一次 pan 丢失） */
export function flushViewportNow(canvasId: number, vp: Viewport): void {
  const existing = flushTimers.get(canvasId)
  if (existing) {
    clearTimeout(existing)
    flushTimers.delete(canvasId)
  }
  void window.api.updateCanvasViewport(canvasId, vp.x, vp.y, vp.scale)
}

export const useCanvasViewportStore = create<CanvasViewportState>((set) => ({
  byId: {},

  initViewport: (canvasId: number, vp: Viewport) => {
    set((s) => {
      if (s.byId[canvasId]) return {}
      return { byId: { ...s.byId, [canvasId]: vp } }
    })
  },

  setViewport: (canvasId: number, vp: Viewport) => {
    set((s) => ({ byId: { ...s.byId, [canvasId]: vp } }))
    scheduleFlush(canvasId, vp)
  }
}))

export { DEFAULT_VIEWPORT }
