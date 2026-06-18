import type { CanvasItem } from '../../../main/canvases'
import type { Viewport } from './canvasMath'

type Direction = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'

const DIR_VECTORS: Record<Direction, [number, number]> = {
  ArrowRight: [1, 0],
  ArrowLeft: [-1, 0],
  ArrowDown: [0, 1],
  ArrowUp: [0, -1],
}

/**
 * 方向键导航：返回应切换选中的 canvas_item.id，找不到则返回 null。
 * - 无选中：选视口中心最近的元素
 * - 有选中：从选区中心出发，找方向锥 (cosθ > 0.5) 内距离最近的元素
 */
export function navigateDirection(
  direction: Direction,
  items: CanvasItem[],
  selected: Set<number>,
  viewport: Viewport,
  containerW: number,
  containerH: number,
): number | null {
  if (items.length === 0) return null

  if (selected.size === 0) {
    // 无选中：找视口中心最近的
    const cx = viewport.x + containerW / 2 / viewport.scale
    const cy = viewport.y + containerH / 2 / viewport.scale
    let best: CanvasItem | null = null
    let bestDist = Infinity
    for (const item of items) {
      const d = (item.x - cx) ** 2 + (item.y - cy) ** 2
      if (d < bestDist) { bestDist = d; best = item }
    }
    return best?.id ?? null
  }

  // 有选中：以选区中心为起点
  const selItems = items.filter((it) => selected.has(it.id))
  if (selItems.length === 0) return null
  const ox = selItems.reduce((s, it) => s + it.x, 0) / selItems.length
  const oy = selItems.reduce((s, it) => s + it.y, 0) / selItems.length

  const [dx, dy] = DIR_VECTORS[direction]
  let best: CanvasItem | null = null
  let bestDist = Infinity

  for (const item of items) {
    if (selected.has(item.id)) continue
    const vx = item.x - ox
    const vy = item.y - oy
    const len = Math.sqrt(vx * vx + vy * vy)
    if (len < 1e-6) continue
    const cos = (vx * dx + vy * dy) / len
    if (cos <= 0.5) continue
    const dist = vx * vx + vy * vy
    if (dist < bestDist) { bestDist = dist; best = item }
  }

  return best?.id ?? null
}

/**
 * 若元素中心不在视口内，返回让元素居中的新视口；否则返回 null。
 */
export function panToItem(
  item: CanvasItem,
  viewport: Viewport,
  containerW: number,
  containerH: number,
): Viewport | null {
  const sx = (item.x - viewport.x) * viewport.scale
  const sy = (item.y - viewport.y) * viewport.scale
  const margin = 40
  const inView =
    sx >= margin && sx <= containerW - margin &&
    sy >= margin && sy <= containerH - margin
  if (inView) return null
  return {
    x: item.x - containerW / 2 / viewport.scale,
    y: item.y - containerH / 2 / viewport.scale,
    scale: viewport.scale,
  }
}
