import type { GridSize } from '../stores/ui'

/**
 * 瀑布流列数计算 —— 探索 / 分类等所有 Masonry 视图共用。
 *
 * 以"目标列宽"反推列数：尺寸档越大目标列宽越大、列数越少、缩略图越大。
 * 仍随容器宽度自适应，只是整体粗细由 gridSize 调节。
 */
const TARGET_WIDTH: Record<GridSize, number> = {
  small: 190,
  medium: 270,
  large: 380
}

/** 各尺寸档的目标列宽（masonic 按此推列数；瀑布流虚拟化用） */
export { TARGET_WIDTH }

export function getColumns(containerWidth: number, size: GridSize): number {
  const target = TARGET_WIDTH[size]
  return Math.max(2, Math.round(containerWidth / target))
}

/** 尺寸档对应的中文短标签（按钮展示用） */
export const GRID_SIZE_LABEL: Record<GridSize, string> = {
  small: '小',
  medium: '中',
  large: '大'
}
