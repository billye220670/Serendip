import { createContext, useContext, useCallback, useEffect, useMemo } from 'react'
import { Masonry, useInfiniteLoader, type RenderComponentProps } from 'masonic'
import { MediaCard } from './MediaCard'
import { useUIStore } from '../stores/ui'
import { TARGET_WIDTH } from '../lib/grid'
import type { MediaItem } from '../../../main/recommender'
import type { SelectMods } from '../stores/selection'

/**
 * 虚拟化瀑布流 —— 基于 masonic 的窗口化瀑布流，只挂载视口附近的卡片，DOM 数恒定。
 * 探索 / 分类 / 喜欢三视图共用。数据模型不变：仍读视图的只增 `items`，按 id 复用卡片，
 * 所以往上滚回是原样还原、不会重新随机。
 *
 * masonic 的 `render` 只接收 `{index,data,width}` 且要求组件引用稳定，
 * 故卡片回调走 context 传入（值用 useMemo 稳定），module 级 `MasonryCard` 消费。
 */

const SPACING = 12 // 列间距 / 行间距，与原 react-photo-album 一致

interface GridHandlers {
  onLikeToggle: (id: number, liked: boolean) => void
  onContextMenu?: (e: React.MouseEvent, item: MediaItem) => void
  onThumbError?: (item: MediaItem) => void
  onSelectClick?: (item: MediaItem, mods: SelectMods) => void
  onLongPress?: (item: MediaItem) => void
  onOpenDetail?: (item: MediaItem) => void
}

const GridHandlersContext = createContext<GridHandlers | null>(null)

/** 单元格：按列宽与原始宽高比算出高度，masonic 据此定位（首屏无跳动） */
function MasonryCard({ data, width }: RenderComponentProps<MediaItem>): React.JSX.Element {
  const h = useContext(GridHandlersContext)!
  const ratio = (data.height || 3) / (data.width || 4)
  const height = Math.round(width * ratio)
  return (
    <div style={{ height }}>
      <MediaCard
        item={data}
        onLikeToggle={h.onLikeToggle}
        onContextMenu={h.onContextMenu}
        onThumbError={h.onThumbError}
        onSelectClick={h.onSelectClick}
        onLongPress={h.onLongPress}
        onOpenDetail={h.onOpenDetail}
      />
    </div>
  )
}

// 模块级稳定引用，避免每次 render 重建影响 masonic 的无限加载缓存
const isItemLoaded = (index: number, list: MediaItem[]): boolean => index < list.length
const LOADER_OPTIONS = { isItemLoaded, threshold: 8 }
const itemKey = (data: MediaItem): number => data.id

interface MasonryGridProps extends GridHandlers {
  items: MediaItem[]
  /** 数据根本性重置时变化（切模式/根目录/分类）→ 整体重挂、滚动归零 */
  resetKey: string
  /** 触底加载更多；省略 = 有限列表（分类 / 喜欢一次拉全） */
  onLoadMore?: () => void
}

export function MasonryGrid({
  items,
  resetKey,
  onLoadMore,
  onLikeToggle,
  onContextMenu,
  onThumbError,
  onSelectClick,
  onLongPress,
  onOpenDetail
}: MasonryGridProps): React.JSX.Element {
  const gridSize = useUIStore((s) => s.gridSize)
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed)
  const columnWidth = TARGET_WIDTH[gridSize]

  // 侧栏折叠改的是容器宽度（非 window），masonic 默认只在 window resize 时重测宽度。
  // 动画（250ms）结束后派发一次 resize 触发重算：动画期间沿用旧布局、结束一次性 snap，
  // 因虚拟化只重渲可见项，成本极低。配合 <main> 的 overflow-x-clip 裁掉展开瞬间的溢出。
  useEffect(() => {
    const t = window.setTimeout(() => window.dispatchEvent(new Event('resize')), 300)
    return () => window.clearTimeout(t)
  }, [sidebarCollapsed])

  const handlers = useMemo<GridHandlers>(
    () => ({
      onLikeToggle,
      onContextMenu,
      onThumbError,
      onSelectClick,
      onLongPress,
      onOpenDetail
    }),
    [onLikeToggle, onContextMenu, onThumbError, onSelectClick, onLongPress, onOpenDetail]
  )

  const loadMore = useCallback(async () => {
    onLoadMore?.()
  }, [onLoadMore])
  const maybeLoadMore = useInfiniteLoader(loadMore, LOADER_OPTIONS)

  return (
    <GridHandlersContext.Provider value={handlers}>
      <Masonry
        key={resetKey}
        items={items}
        columnGutter={SPACING}
        columnWidth={columnWidth}
        overscanBy={2}
        itemKey={itemKey}
        itemHeightEstimate={Math.round(columnWidth * 1.2)}
        render={MasonryCard}
        onRender={onLoadMore ? maybeLoadMore : undefined}
      />
    </GridHandlersContext.Provider>
  )
}
