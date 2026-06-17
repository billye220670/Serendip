import { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  useInfiniteLoader,
  usePositioner,
  useResizeObserver,
  useMasonry,
  type RenderComponentProps
} from 'masonic'
import { MediaCard } from './MediaCard'
import { useUIStore } from '../stores/ui'
import { TARGET_WIDTH } from '../lib/grid'
import { useScrollContainer, useContainerScroller } from '../lib/scrollContainer'
import type { MediaItem } from '../../../main/recommender'
import type { SelectMods } from '../stores/selection'

/**
 * 虚拟化瀑布流 —— 基于 masonic 的窗口化瀑布流，只挂载视口附近的卡片，DOM 数恒定。
 * 探索 / 分类 / 喜欢三视图共用。数据模型不变：仍读视图的只增 `items`，按 id 复用卡片，
 * 所以往上滚回是原样还原、不会重新随机。
 *
 * 滚动模型：从 ScrollContainerContext 拿主区 ref（App 的 <main>），
 * 用 useContainerScroller 替代 masonic 的 window-scroll 默认值。这样滚动条只在主区出现，
 * 不会冲到顶栏上面。masonic 提供 useMasonry 这种"无副作用"的底层 API，正适合这种替换。
 *
 * masonic 的 `render` 只接收 `{index,data,width}` 且要求组件引用稳定，
 * 故卡片回调走 context 传入（值用 useMemo 稳定），module 级 `MasonryCard` 消费。
 */

const SPACING = 12 // 列间距 / 行间距

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
const itemKey = (data: MediaItem, index: number): number => data?.id ?? index

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

  // masonic 的 <Masonry> 内部以 window 尺寸作为 deps，侧边栏折叠不改变 window 尺寸，
  // 所以改用底层 API 自己控制 containerWidth。
  // 用 sidebarCollapsed 变化 + 260ms 延迟（动画 250ms 结束后）一次性读容器宽度，
  // 动画过程中不触发，避免每帧抖动。
  const containerRef = useRef<HTMLElement | null>(null)
  const scrollEl = useScrollContainer()

  const [containerWidth, setContainerWidth] = useState(() =>
    scrollEl?.clientWidth ?? window.innerWidth
  )
  // masonry 容器在滚动容器内的 offsetTop（视图通常加 p-4 头部 = 16），用于换算 scrollTop
  const [offsetTop, setOffsetTop] = useState(0)

  const readGeometry = useCallback(() => {
    const grid = containerRef.current
    if (!grid) return
    setContainerWidth(grid.offsetWidth)
    // grid.offsetTop = 距最近 positioned 祖先的偏移。App 的 <main> 是 position:relative，
    // 也是 scrollEl，所以 offsetTop 就是 grid 在滚动容器内的位置 —— 直接用即可
    setOffsetTop((grid as HTMLElement).offsetTop)
  }, [])

  // 侧边栏动画结束后读一次
  useEffect(() => {
    const t = window.setTimeout(readGeometry, 260)
    return () => window.clearTimeout(t)
  }, [sidebarCollapsed, readGeometry])

  // 容器尺寸变化（resize / 进入新视图 / 数据从空到非空）实时更新
  useEffect(() => {
    readGeometry()
    const grid = containerRef.current
    if (!grid) return
    const ro = new ResizeObserver(readGeometry)
    ro.observe(grid)
    if (scrollEl) ro.observe(scrollEl)
    window.addEventListener('resize', readGeometry)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', readGeometry)
    }
  }, [readGeometry, scrollEl])

  const positioner = usePositioner(
    {
      width: containerWidth,
      columnGutter: SPACING,
      columnWidth
    },
    [resetKey]
  )
  const resizeObserver = useResizeObserver(positioner)
  const { scrollTop, isScrolling, viewportHeight } = useContainerScroller(scrollEl, offsetTop)

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

  const masonry = useMasonry({
    positioner,
    resizeObserver,
    containerRef,
    items,
    scrollTop,
    isScrolling,
    height: viewportHeight,
    overscanBy: 2,
    itemKey,
    itemHeightEstimate: Math.round(columnWidth * 1.2),
    render: MasonryCard,
    onRender: onLoadMore ? maybeLoadMore : undefined
  })

  return (
    <GridHandlersContext.Provider value={handlers}>
      {masonry}
    </GridHandlersContext.Provider>
  )
}
