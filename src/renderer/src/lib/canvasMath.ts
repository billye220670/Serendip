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

/** 画布自动布局：等高行的行高（世界像素） */
export const GRID_ROW_HEIGHT = 240
/** 画布自动布局：元素间距（世界像素） */
export const GRID_GAP = 16

/** 黄金角（≈137.5°），向日葵种子式无方向偏好扩散 */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

/** 两个轴对齐矩形（cx/cy 为中心）是否相交 */
function rectsOverlap(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number
): boolean {
  return (
    Math.abs(ax - bx) * 2 < aw + bw &&
    Math.abs(ay - by) * 2 < ah + bh
  )
}

/**
 * 等高行（justified rows）布局：
 * - 每个元素缩放到统一行高 rowHeight，宽 = rowHeight × 各自宽高比
 * - 贪心换行，使整块趋近正方形（行右缘大致对齐，图片紧贴），对齐 PureRef 的紧凑网格观感
 *
 * 返回每个元素相对「块左上角原点」的中心坐标 {x,y,w,h}，以及整块尺寸 blockW/blockH。
 * 调用方负责把块平移到目标锚点（见 addItems / handleRearrangeAll）。
 */
export function layoutJustifiedRows(
  aspects: number[],
  opts?: { rowHeight?: number; gap?: number }
): { positions: Array<{ x: number; y: number; w: number; h: number }>; blockW: number; blockH: number } {
  const H = opts?.rowHeight ?? GRID_ROW_HEIGHT
  const gap = opts?.gap ?? GRID_GAP
  const n = aspects.length
  if (n === 0) return { positions: [], blockW: 0, blockH: 0 }

  // 每项缩到等高，宽按比例（比例非法时回退 4:3）
  const widths = aspects.map((a) => H * (a && a > 0 && isFinite(a) ? a : 4 / 3))
  const sumW = widths.reduce((s, w) => s + w, 0)

  // 目标行数 R≈√(ΣW/H) 时整块接近正方形；目标行宽 = ΣW/R
  const rows = Math.max(1, Math.round(Math.sqrt(sumW / H)))
  const targetRowW = sumW / rows

  const positions = new Array<{ x: number; y: number; w: number; h: number }>(n)
  let blockW = 0
  let rowTop = 0
  let rowX = 0
  let rowW = 0 // 当前行已用宽（含行内间距）

  for (let i = 0; i < n; i++) {
    const w = widths[i]
    // 当前行已有内容且加入本项后超过目标行宽 → 先换行
    if (rowW > 0 && rowW + gap + w > targetRowW) {
      blockW = Math.max(blockW, rowW)
      rowTop += H + gap
      rowX = 0
      rowW = 0
    }
    if (rowW > 0) {
      rowX += gap
      rowW += gap
    }
    positions[i] = { x: rowX + w / 2, y: rowTop + H / 2, w, h: H }
    rowX += w
    rowW += w
  }
  blockW = Math.max(blockW, rowW)
  const blockH = rowTop + H

  return { positions, blockW, blockH }
}

/**
 * 为「整块」找到离现有内容视觉中心最近的空白落点（块中心世界坐标）。
 * 黄金角螺旋候选 + 块 AABB 对现有元素 AABB 碰撞测试（含 gap 间距），首个不相交即返回。
 * 画布为空时直接返回 (0,0)。
 */
export function findBlockPlacement(
  blockW: number,
  blockH: number,
  existing: Array<{ x: number; y: number; w: number; h: number; rotation: number }>,
  gap = GRID_GAP
): { x: number; y: number } {
  if (existing.length === 0) return { x: 0, y: 0 }

  // 现有内容整体包围盒中心
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  const boxes = existing.map((it) => {
    const a = aabbOfRotatedRect(it.x, it.y, it.w, it.h, it.rotation)
    if (a.minX < minX) minX = a.minX
    if (a.minY < minY) minY = a.minY
    if (a.maxX > maxX) maxX = a.maxX
    if (a.maxY > maxY) maxY = a.maxY
    return { cx: (a.minX + a.maxX) / 2, cy: (a.minY + a.maxY) / 2, w: a.maxX - a.minX, h: a.maxY - a.minY }
  })
  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2

  const testW = blockW + gap * 2
  const testH = blockH + gap * 2
  const baseStep = (Math.max(blockW, blockH) + gap) * 0.5

  for (let i = 0; i < 4000; i++) {
    const r = baseStep * Math.sqrt(i)
    const theta = i * GOLDEN_ANGLE
    const cx = centerX + r * Math.cos(theta)
    const cy = centerY + r * Math.sin(theta)
    let hit = false
    for (const b of boxes) {
      if (rectsOverlap(cx, cy, testW, testH, b.cx, b.cy, b.w, b.h)) {
        hit = true
        break
      }
    }
    if (!hit) return { x: cx, y: cy }
  }
  // 兜底（几乎不会触发）：放到现有内容正下方
  return { x: centerX, y: maxY + blockH / 2 + gap }
}
