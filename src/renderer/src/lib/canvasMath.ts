import type { CanvasItem } from '../../../main/canvases'

export interface Viewport {
  x: number
  y: number
  scale: number
}

export const DEFAULT_VIEWPORT: Viewport = Object.freeze({ x: 0, y: 0, scale: 1 })

const SCALE_MIN = 0.05
const SCALE_MAX = 32
/** 离散缩放每档倍率，scale=1 为 0 档 */
export const ZOOM_STEP = 1.2

export function clampScale(scale: number): number {
  return Math.max(SCALE_MIN, Math.min(SCALE_MAX, scale))
}

/** 屏幕坐标 → 世界坐标 */
export function screenToWorld(screenX: number, screenY: number, vp: Viewport): [number, number] {
  return [screenX / vp.scale + vp.x, screenY / vp.scale + vp.y]
}

/** 世界坐标 → 屏幕坐标 */
export function worldToScreen(worldX: number, worldY: number, vp: Viewport): [number, number] {
  return [(worldX - vp.x) * vp.scale, (worldY - vp.y) * vp.scale]
}

/** 计算旋转矩形的轴对齐包围盒（x/y 为中心点） */
export function aabbOfRotatedRect(
  cx: number,
  cy: number,
  w: number,
  h: number,
  rotation: number
): { minX: number; minY: number; maxX: number; maxY: number } {
  const hw = w / 2
  const hh = h / 2
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  const xs = [
    cx + cos * hw - sin * hh,
    cx - cos * hw - sin * hh,
    cx + cos * hw + sin * hh,
    cx - cos * hw + sin * hh
  ]
  const ys = [
    cy + sin * hw + cos * hh,
    cy - sin * hw + cos * hh,
    cy + sin * hw - cos * hh,
    cy - sin * hw - cos * hh
  ]
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys)
  }
}

/** 计算能完整展示所有元素的视口（带 padding 比例） */
export function fitViewport(
  items: CanvasItem[],
  viewW: number,
  viewH: number,
  padding = 0.1
): Viewport {
  if (items.length === 0) return { ...DEFAULT_VIEWPORT }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const item of items) {
    const aabb = aabbOfRotatedRect(item.x, item.y, item.w, item.h, item.rotation)
    if (aabb.minX < minX) minX = aabb.minX
    if (aabb.minY < minY) minY = aabb.minY
    if (aabb.maxX > maxX) maxX = aabb.maxX
    if (aabb.maxY > maxY) maxY = aabb.maxY
  }

  const aabbW = maxX - minX
  const aabbH = maxY - minY

  if (aabbW === 0 && aabbH === 0) {
    return { x: minX - viewW / 2, y: minY - viewH / 2, scale: 1 }
  }

  const padFactor = 1 - padding * 2
  const scaleX = aabbW > 0 ? (viewW * padFactor) / aabbW : SCALE_MAX
  const scaleY = aabbH > 0 ? (viewH * padFactor) / aabbH : SCALE_MAX
  const scale = clampScale(Math.min(scaleX, scaleY))

  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2

  return {
    x: centerX - viewW / 2 / scale,
    y: centerY - viewH / 2 / scale,
    scale
  }
}

/**
 * 计算新增元素的智能布局位置：
 * - 以现有元素的质心为基准，斜向级联排布（模拟叠扇效果）
 * - 新元素的 z 始终高于所有现有元素，最后加入的在最上层
 * - 允许与现有元素部分重叠，不做避让
 *
 * x/y 均为中心点世界坐标。
 */
export function computeWaterfallPositions(
  fileIds: number[],
  existingItems: Array<{ x: number; y: number; w: number; h: number; z: number }>,
  options?: { colWidth?: number; colHeight?: number }
): Array<{ fileId: number; x: number; y: number; w: number; h: number; z: number }> {
  const W = options?.colWidth ?? 240
  const H = options?.colHeight ?? 180

  // 斜向步长：W×0.6（≈144）、H×0.6（≈108），视觉上充分分开
  const stepX = W * 0.6
  const stepY = H * 0.6

  // 以 z 最大的元素（最后加入的）为基准，向右下偏移一步开始放置
  // 若画布为空则从原点开始
  const maxZ = existingItems.length > 0 ? Math.max(...existingItems.map((it) => it.z)) : 0
  const lastItem = existingItems.length > 0
    ? existingItems.reduce((a, b) => (a.z > b.z ? a : b))
    : null

  const baseX = lastItem ? lastItem.x + stepX : 0
  const baseY = lastItem ? lastItem.y + stepY : 0

  return fileIds.map((fileId, i) => ({
    fileId,
    x: baseX + i * stepX,
    y: baseY + i * stepY,
    w: W,
    h: H,
    z: maxZ + i + 1
  }))
}
