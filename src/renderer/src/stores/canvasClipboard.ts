import { create } from 'zustand'

/**
 * 画布内部剪贴板（非系统剪贴板）：保存被复制元素的完整变换快照。
 * 模块单例，跨画布有效——可在 A 画布复制、B 画布粘贴。
 * x/y 为中心点世界坐标；粘贴时按组包围盒中心重定位到光标。
 */
export interface CanvasClip {
  fileId: number
  x: number
  y: number
  w: number
  h: number
  rotation: number
  clipPolygon: string | null
}

interface CanvasClipboardState {
  clips: CanvasClip[]
  setClips: (clips: CanvasClip[]) => void
  clear: () => void
}

export const useCanvasClipboardStore = create<CanvasClipboardState>((set) => ({
  clips: [],
  setClips: (clips) => set({ clips }),
  clear: () => set({ clips: [] })
}))
