import { useEffect, useRef, useState, useCallback } from 'react'
import { useInView } from 'react-intersection-observer'
import { ChevronLeft, ImageOff, VideoOff, ChevronRight, PanelRightOpen, PanelRightClose, Play, Heart, HeartOff, Hash, MoreVertical, EyeOff, FolderOpen, Folder } from 'lucide-react'
import clsx from 'clsx'
import { useDetailStore, BUFFER_SIZE, type SeqEntry } from '../stores/detail'
import { useLibraryStore } from '../stores/library'
import { useUIStore } from '../stores/ui'
import { usePanelRecommendationsStore } from '../stores/panelRecommendations'
import { useCategoriesStore } from '../stores/categories'
import { CategorySearchPanel } from '../components/CategorySearchPanel'
import { ContextMenu, type ContextMenuItem } from '../components/ContextMenu'
import type { MediaItem } from '../../../main/recommender'

/**
 * 详情页（沉浸欣赏页）—— 全屏 fixed overlay（z-50），底层瀑布流不销毁。
 * 阶段 2：滚轮/键盘切换 + 接力队列 + j 圆点 + 切图转场 + 预加载。
 */
export function DetailView(): React.JSX.Element | null {
  const isOpen = useDetailStore((s) => s.isOpen)
  const sequence = useDetailStore((s) => s.sequence)
  const cursor = useDetailStore((s) => s.cursor)
  const scopePath = useDetailStore((s) => s.scopePath)
  const setScope = useDetailStore((s) => s.setScope)
  const close = useDetailStore((s) => s.close)
  const next = useDetailStore((s) => s.next)
  const prev = useDetailStore((s) => s.prev)
  const jumpTo = useDetailStore((s) => s.jumpTo)
  const rootPath = useLibraryStore((s) => s.rootPath)
  const panelOpen = useUIStore((s) => s.detailPanelOpen)
  const togglePanel = useUIStore((s) => s.toggleDetailPanel)
  const theme = useUIStore((s) => s.theme)
  const isLight = theme === 'light'

  const currentItem = sequence[cursor]?.item ?? null
  const resetPanel = usePanelRecommendationsStore((s) => s.reset)
  const destroyPanel = usePanelRecommendationsStore((s) => s.destroy)
  const loadStats = useLibraryStore((s) => s.loadStats)

  // ===== f/g 状态：喜欢 + 分类归属 =====
  const categories = useCategoriesStore((s) => s.categories)
  const loadCategories = useCategoriesStore((s) => s.load)
  const addItemsToCategory = useCategoriesStore((s) => s.addItems)
  const removeItemsFromCategory = useCategoriesStore((s) => s.removeItems)
  const createCategory = useCategoriesStore((s) => s.create)

  const [itemLiked, setItemLiked] = useState(false)
  const [itemCategoryIds, setItemCategoryIds] = useState<Set<number>>(new Set())
  const [searchOpen, setSearchOpen] = useState(false)

  // 打开详情页时确保分类列表已加载
  useEffect(() => {
    if (isOpen && !useCategoriesStore.getState().loaded) {
      void loadCategories()
    }
  }, [isOpen, loadCategories])

  // 切图时刷新 liked + categoryIds
  useEffect(() => {
    if (!currentItem) {
      setItemLiked(false)
      setItemCategoryIds(new Set())
      return
    }
    setItemLiked(!!currentItem.liked)
    void window.api.getFileCategoryIds(currentItem.id).then((ids) => {
      setItemCategoryIds(new Set(ids))
    })
  }, [currentItem?.id])

  // 切图时关闭搜索面板
  useEffect(() => {
    setSearchOpen(false)
  }, [currentItem?.id])

  const handleLikeToggle = useCallback(async () => {
    if (!currentItem) return
    const newLiked = !itemLiked
    setItemLiked(newLiked)
    await window.api.setLiked(currentItem.id, newLiked)
    await loadStats()
  }, [currentItem, itemLiked, loadStats])

  const handleCategoryToggle = useCallback(
    async (categoryId: number) => {
      if (!currentItem) return
      const isIn = itemCategoryIds.has(categoryId)
      setItemCategoryIds((prev) => {
        const next = new Set(prev)
        if (isIn) next.delete(categoryId)
        else next.add(categoryId)
        return next
      })
      if (isIn) {
        await removeItemsFromCategory(categoryId, [currentItem.id])
      } else {
        await addItemsToCategory(categoryId, [currentItem.id])
      }
    },
    [currentItem, itemCategoryIds, addItemsToCategory, removeItemsFromCategory]
  )

  const handleCategoryCreate = useCallback(
    async (name: string) => {
      if (!currentItem) return
      const newId = await createCategory(name)
      setItemCategoryIds((prev) => new Set([...prev, newId]))
      await addItemsToCategory(newId, [currentItem.id])
    },
    [currentItem, createCategory, addItemsToCategory]
  )

  // 面板数据 reset：folder_path 变化时触发（同路径下切换图不重置）
  useEffect(() => {
    if (currentItem && rootPath) {
      resetPanel(currentItem.folder_path, rootPath)
    }
  }, [currentItem?.folder_path, rootPath, resetPanel])

  // 详情页关闭时销毁面板
  useEffect(() => {
    return () => {
      if (!isOpen) destroyPanel()
    }
  }, [isOpen, destroyPanel])

  // 转场：isOpen 变化后延一帧驱动 CSS opacity/transform
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (isOpen) {
      const raf = requestAnimationFrame(() => setVisible(true))
      return () => cancelAnimationFrame(raf)
    }
    setVisible(false)
    return undefined
  }, [isOpen])

  // 打开时锁定 body 滚动，防止滚轮穿透到底层瀑布流
  useEffect(() => {
    if (isOpen) {
      const prev = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = prev }
    }
    return undefined
  }, [isOpen])

  // 滚轮：基于 deltaY 累积，每达到 WHEEL_THRESHOLD 才切一张。
  // 与 wheel 事件密度解耦 —— 鼠标滚轮一刻度 ≈ 100~120，触控板按物理滑动距离累计；
  // 没有时间节流，缩略图随用户操作立即响应，大图各自异步加载到位时由 ImageViewer 内部 swap。
  const accumRef = useRef(0)
  const WHEEL_THRESHOLD = 100
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.stopPropagation()
    // 反向滚动：先把累计值归零，避免反向时还要先消耗掉同向余量
    if (accumRef.current !== 0 && Math.sign(e.deltaY) !== Math.sign(accumRef.current)) {
      accumRef.current = 0
    }
    accumRef.current += e.deltaY
    while (accumRef.current >= WHEEL_THRESHOLD) {
      next()
      accumRef.current -= WHEEL_THRESHOLD
    }
    while (accumRef.current <= -WHEEL_THRESHOLD) {
      prev()
      accumRef.current += WHEEL_THRESHOLD
    }
  }, [next, prev])

  // 键盘：Esc / ←→ / 空格 / Tab。
  // 用左右而非上下，与底部缩略图导航的左右排布心智对齐（→ 下一张，← 上一张）
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        if (searchOpen) { setSearchOpen(false); return }
        close()
        return
      }
      if (searchOpen) return
      if (e.key === 'Tab') { e.preventDefault(); togglePanel(); return }
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); next() }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); prev() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, searchOpen, close, next, prev, togglePanel])

  if (!isOpen && !visible) return null
  if (!currentItem) return null

  return (
    <div
      className={clsx(
        'fixed inset-0 z-50 flex flex-row',
        isLight ? 'bg-stone-200' : 'bg-black',
        'transition-opacity duration-300',
        visible ? 'opacity-100' : 'opacity-0'
      )}
      onWheel={handleWheel}
    >
      {/* 左区（主舞台）：relative 让顶栏渐变 / 顶栏 / 缩略图条以 absolute 锚到左区。
          flex-1 + min-w-0 让右侧面板挤压时宽度自然让出 */}
      <div className="relative flex-1 min-w-0 flex flex-col items-center justify-center">
        {/* 顶部黑色渐变遮罩：从顶部向下淡出，提升面包屑/按钮在亮图上的可读性 */}
        <div
          className="absolute top-0 left-0 right-0 h-28 z-10 pointer-events-none"
          style={{
            background: isLight
              ? 'linear-gradient(to bottom, rgba(214,211,209,0.92), rgba(214,211,209,0.45), transparent)'
              : 'linear-gradient(to bottom, rgba(0,0,0,0.75), rgba(0,0,0,0.4), transparent)',
          }}
        />

        {/* 顶栏：后退 + 面包屑 + 面板开关。right-0 即左区右边界，按钮自然贴近面板 */}
        <div className="absolute top-0 left-0 right-0 z-10 flex items-center gap-3 px-4 py-3">
          <button
            onClick={close}
            aria-label="后退"
            className={clsx(
              'flex-shrink-0 grid place-items-center w-11 h-11 rounded-full transition-colors focus:outline-none focus-visible:outline-none',
              isLight ? 'bg-black/10 text-foreground hover:bg-black/15' : 'bg-black/45 text-white hover:bg-black/65'
            )}
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
          <div className="flex-1 min-w-0">
            <Breadcrumb
              item={currentItem}
              rootPath={rootPath}
              scopePath={scopePath}
              onSetScope={setScope}
            />
          </div>
          <button
            onClick={togglePanel}
            aria-label={panelOpen ? '收起推荐面板' : '展开推荐面板'}
            title={panelOpen ? '收起推荐（Tab）' : '推荐（Tab）'}
            className={clsx(
              'flex-shrink-0 grid place-items-center w-11 h-11 rounded-full transition-colors focus:outline-none focus-visible:outline-none',
              isLight ? 'bg-black/10 text-foreground hover:bg-black/15' : 'bg-black/45 text-white hover:bg-black/65'
            )}
          >
            {panelOpen ? <PanelRightClose className="w-5 h-5" /> : <PanelRightOpen className="w-5 h-5" />}
          </button>
        </div>

        {/* 内容区（瞬切，无位移动效）。父容器宽度随面板挤压收缩，img 自动 fit */}
        <div className="w-full h-full flex items-center justify-center">
          {currentItem.type === 'video' ? (
            <VideoPlayer item={currentItem} />
          ) : (
            <ImageViewer item={currentItem} />
          )}
        </div>

        {/* 底部缩略图条：left-1/2 相对左区中点，挤压后随之向左居中 */}
        <ThumbStrip sequence={sequence} cursor={cursor} jumpTo={jumpTo} />

        {/* 底部左侧操作区：喜欢(f) + 分隔线 + 分类入口(h)，不与缩略图条争位 */}
        <div className="absolute bottom-6 left-4 z-20 flex items-center gap-2">
          {/* f：喜欢 */}
          <button
            onClick={() => { void handleLikeToggle() }}
            aria-label={itemLiked ? '取消喜欢' : '喜欢'}
            className={clsx(
              'grid place-items-center w-11 h-11 rounded-full transition-colors focus:outline-none',
              itemLiked
                ? 'bg-pink-500/90 text-white hover:bg-pink-400/90'
                : isLight
                  ? 'bg-black/10 text-foreground/60 hover:bg-black/15 hover:text-foreground'
                  : 'bg-black/45 text-white/70 hover:bg-black/65 hover:text-white'
            )}
          >
            <Heart className={clsx('w-5 h-5', itemLiked && 'fill-current')} />
          </button>

          <div className={isLight ? 'w-px h-6 bg-foreground/15' : 'w-px h-6 bg-white/25'} />

          {/* h：# 按钮，relative 用于面板锚定 */}
          <div className="relative">
            <button
              onClick={() => setSearchOpen((v) => !v)}
              aria-label="管理分类"
              title="管理分类"
              className={clsx(
                'grid place-items-center w-11 h-11 rounded-full transition-colors focus:outline-none',
                searchOpen
                  ? 'bg-primary text-white'
                  : isLight
                    ? 'bg-black/10 text-foreground/60 hover:bg-black/15 hover:text-foreground'
                    : 'bg-black/45 text-white/70 hover:bg-black/65 hover:text-white'
              )}
            >
              <Hash className="w-5 h-5" />
            </button>

            {/* 分类搜索面板：absolute bottom-full，锚定在 # 按钮上方 */}
            {searchOpen && (
              <CategorySearchPanel
                fileId={currentItem.id}
                categories={categories}
                memberIds={itemCategoryIds}
                onToggle={handleCategoryToggle}
                onCreate={handleCategoryCreate}
                onClose={() => setSearchOpen(false)}
              />
            )}
          </div>
        </div>

        {/* 面板打开时的透明点击捕获层（点面板外区域关闭，z-[19] 低于操作区 z-20） */}
        {searchOpen && (
          <div
            className="absolute inset-0 z-[19]"
            onClick={() => setSearchOpen(false)}
          />
        )}
      </div>

      {/* 右侧推荐面板（d）— 挤压布局：宽度受 open 切换 0/PANEL_WIDTH，width 动画收展 */}
      <RecommendationsPanel open={panelOpen} />

      {/* 预加载下 1-2 张图（不可见） */}
      <Preloader sequence={sequence} cursor={cursor} />
    </div>
  )
}

/**
 * 图片查看器 —— 激进瞬切 + 缩略图兜底。
 *
 * 渲染规则：
 * - 始终先把 320px 缩略图盖底（必然命中本地 cache，几乎瞬切）。
 * - 同步加载原图，onLoad 触发时立即覆盖在上层（无淡入，瞬切）。
 * - 切到下一张时，fullLoaded 重置；如果原图还没回来，用户暂时看的是新图的缩略图，避免空白。
 * - 原图加载失败显示纯黑底 + 提示。
 */
function ImageViewer({ item }: { item: MediaItem }): React.JSX.Element {
  const [fullLoaded, setFullLoaded] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    setFullLoaded(false)
    setError(false)
  }, [item.id])

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <ImageOff className="w-12 h-12" />
        <p className="text-sm">无法加载图片</p>
      </div>
    )
  }

  return (
    <div className="relative w-full h-full flex items-center justify-center">
      {/* 缩略图兜底层：仅在原图未到位时显示，无 blur、无 transition，纯瞬切 */}
      {!fullLoaded && (
        <img
          src={`serendip://thumb/${item.id}`}
          alt=""
          className="absolute max-w-full max-h-full object-contain select-none pointer-events-none"
          draggable={false}
        />
      )}
      {/* 原图层：onLoad 时立即显示并覆盖兜底层 */}
      <img
        src={`serendip://image/${item.id}`}
        alt=""
        className="absolute max-w-full max-h-full object-contain select-none"
        draggable={false}
        style={{ opacity: fullLoaded ? 1 : 0 }}
        onLoad={() => setFullLoaded(true)}
        onError={() => {
          console.warn(`Image load failed: item ${item.id}`)
          setError(true)
        }}
      />
    </div>
  )
}

/** 视频播放器：单实例，切走立即停止解码 */
function VideoPlayer({ item }: { item: MediaItem }): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [videoError, setVideoError] = useState(false)

  const handleRef = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el
  }, [])

  const handleCanPlay = useCallback(() => {
    videoRef.current?.play().catch(() => { /* 忽略 AbortError */ })
  }, [])

  const handleError = useCallback(() => {
    const el = videoRef.current
    const code = el?.error?.code ?? -1
    const msg = el?.error?.message ?? 'unknown'
    console.error(`Video error for item ${item.id}: code=${code} ${msg}`)
    setVideoError(true)
  }, [item.id])

  useEffect(() => {
    setVideoError(false)
  }, [item.id])

  useEffect(() => {
    return () => {
      videoRef.current?.pause()
    }
  }, [])

  if (videoError) {
    return (
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <VideoOff className="w-12 h-12" />
        <p className="text-sm">视频无法播放</p>
        <p className="text-xs opacity-60">
          此格式可能不受支持（如 HEVC/H.265、ProRes 等）
        </p>
      </div>
    )
  }

  return (
    <video
      ref={handleRef}
      src={`serendip://video/${item.id}`}
      autoPlay
      muted
      controls
      loop
      playsInline
      preload="auto"
      className="w-full h-full object-contain"
      onCanPlay={handleCanPlay}
      onError={handleError}
    />
  )
}

/**
 * 底部缩略图条 — 传送带式增删动画。
 *
 * 显示规则：
 * - 右边界 = 历史访问过的最远位置（visitedMax），不会因回滚而缩减。
 * - 窗口大小最多 BUFFER_SIZE，超过后左侧最旧项滑出。
 * - 当前 cursor 项高亮（白 ring），其余暗色。
 *
 * 动画实现：
 * - 每个项有三相 phase: 'entering' → 'in' → 'leaving'。
 * - inline style 直接控制 width/margin/opacity，避开 CSS keyframe 与 fill-mode 的副作用。
 * - 'entering' 第一帧 width=0，下一帧切到 'in'（width=2.5rem），CSS transition 自然滑入。
 * - 'leaving' 把目标值改回 0，transition 滑出；onTransitionEnd 各自从 DOM 移除。
 */
const THUMB_W_PX = 52
const THUMB_GAP_PX = 7

function ThumbStrip({
  sequence,
  cursor,
  jumpTo,
}: {
  sequence: SeqEntry[]
  cursor: number
  jumpTo: (index: number) => void
}): React.JSX.Element | null {
  const current = sequence[cursor] ?? null

  type Phase = 'entering' | 'in' | 'leaving'
  // key = SeqEntry.key（序列内唯一，可重复同一 mediaId）；mediaId 仅用于取缩略图
  type Entry = { key: number; mediaId: number; phase: Phase }

  const [entries, setEntries] = useState<Entry[]>(() =>
    current ? [{ key: current.key, mediaId: current.item.id, phase: 'in' }] : []
  )

  // 每次 current 变化，把它纳入条目（顺序：保留已有 + 当前在最右）
  useEffect(() => {
    if (!current) return
    setEntries((prev) => {
      const aliveKeys = new Set(prev.filter((e) => e.phase !== 'leaving').map((e) => e.key))
      let next: Entry[] = prev

      if (!aliveKeys.has(current.key)) {
        next = [...prev, { key: current.key, mediaId: current.item.id, phase: 'entering' }]
      }
      // 否则当前项已在条目里（回滚到历史项），只更新高亮即可，无结构变化

      // 控制活跃项总数 ≤ BUFFER_SIZE：超过则把最早的活跃项标 leaving
      const aliveAfter = next.filter((e) => e.phase !== 'leaving')
      const overflow = aliveAfter.length - BUFFER_SIZE
      if (overflow > 0) {
        let toMark = overflow
        next = next.map((e) => {
          if (toMark > 0 && e.phase !== 'leaving') {
            toMark--
            return { ...e, phase: 'leaving' as Phase }
          }
          return e
        })
      }

      return next
    })
  }, [current])

  // entering → in：下一帧切相，触发 width transition
  useEffect(() => {
    if (!entries.some((e) => e.phase === 'entering')) return
    const raf = requestAnimationFrame(() => {
      setEntries((prev) =>
        prev.map((e) => (e.phase === 'entering' ? { ...e, phase: 'in' } : e))
      )
    })
    return () => cancelAnimationFrame(raf)
  }, [entries])

  if (!current) return null

  // 通过 key 反查 sequence 中的下标（用于点击跳转）
  const keyToIndex = new Map<number, number>()
  for (let i = 0; i < sequence.length; i++) keyToIndex.set(sequence[i].key, i)

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex z-10">
      {entries.map(({ key, mediaId, phase }) => {
        const isCurrent = key === current.key
        const collapsed = phase === 'entering' || phase === 'leaving'
        const targetIndex = keyToIndex.get(key)
        return (
          <button
            key={key}
            onClick={() => {
              if (phase !== 'in') return
              if (targetIndex !== undefined) jumpTo(targetIndex)
            }}
            className={clsx(
              'thumb-strip-item h-[52px] rounded focus:outline-none',
              isCurrent && 'ring-2 ring-primary'
            )}
            style={{
              width: collapsed ? 0 : THUMB_W_PX,
              marginRight: collapsed ? 0 : THUMB_GAP_PX,
              opacity: collapsed ? 0 : 1,
              pointerEvents: phase === 'in' ? 'auto' : 'none',
            }}
            onTransitionEnd={(e) => {
              if (e.propertyName !== 'width') return
              if (phase !== 'leaving') return
              setEntries((prev) =>
                prev.filter((x) => !(x.key === key && x.phase === 'leaving'))
              )
            }}
          >
            <div className="relative w-full h-full rounded overflow-hidden">
              <img
                src={`serendip://thumb/${mediaId}`}
                alt=""
                className="w-full h-full object-cover"
                draggable={false}
              />
              {/* 用明暗 tint（而非透明度）区分高亮：非当前项盖一层黑，差异大但暗图仍可辨 */}
              <div
                className={clsx(
                  'absolute inset-0 transition-colors duration-200',
                  isCurrent ? 'bg-transparent' : 'bg-black/60 hover:bg-black/35'
                )}
              />
            </div>
          </button>
        )
      })}
    </div>
  )
}

/** 预加载下 1-2 张图（用隐藏 img 预热浏览器缓存） */
function Preloader({
  sequence,
  cursor,
}: {
  sequence: SeqEntry[]
  cursor: number
}): React.JSX.Element {
  const preloadItems = sequence.slice(cursor + 1, cursor + 3)
  return (
    <div className="sr-only" aria-hidden>
      {preloadItems.map((e) =>
        e.item.type === 'image' ? (
          <img
            key={e.key}
            src={`serendip://image/${e.item.id}`}
            alt=""
          />
        ) : null
      )}
    </div>
  )
}

/**
 * 右侧推荐面板（d） — 双列瀑布流（挤压布局）。
 *
 * 布局：作为顶层 flex 行的右侧子项，撑满全高；宽度由 open 切换 0 ↔ PANEL_WIDTH，
 *      整体大图区随之让出宽度。展开/收起走 width transition，250ms。
 * 内容：双列 grid，每张卡固定 3:4，图片用 absolute inset-0 + object-cover 充满。
 * 数据源：`sequence` 中 cursor 之后的项（与接力队列共享）。
 * 触底：useInView 末尾哨兵触发 prefetchMore() 追加更多。
 * 转场：用 width 而不是 visibility/卸载，保留内部 React 状态；overflow-hidden 让收
 *      起过程内容自然裁掉。
 */
const PANEL_WIDTH = 380 // 双列 + 间距 + 内边距下的舒适宽度

interface PanelMenu {
  x: number
  y: number
  item: MediaItem
}

function RecommendationsPanel({
  open,
}: {
  open: boolean
}): React.JSX.Element {
  const theme = useUIStore((s) => s.theme)
  const isLight = theme === 'light'
  const items = usePanelRecommendationsStore((s) => s.items)
  const loadMore = usePanelRecommendationsStore((s) => s.loadMore)
  const detailOpen = useDetailStore((s) => s.open)
  const categories = useCategoriesStore((s) => s.categories)
  const addItemsToCategory = useCategoriesStore((s) => s.addItems)
  const loadStats = useLibraryStore((s) => s.loadStats)
  const [menu, setMenu] = useState<PanelMenu | null>(null)

  const { ref: bottomRef, inView: bottomInView } = useInView({ rootMargin: '200px' })
  useEffect(() => {
    if (!open) return
    if (bottomInView) loadMore()
  }, [bottomInView, open, loadMore])

  const handleLikeToggle = useCallback(async (item: MediaItem) => {
    const newLiked = !item.liked
    usePanelRecommendationsStore.setState((s) => ({
      items: s.items.map((it) => it.id === item.id ? { ...it, liked: newLiked ? 1 : 0 } : it)
    }))
    await window.api.setLiked(item.id, newLiked)
    void loadStats()
  }, [loadStats])

  const handleAddToCategory = useCallback(async (item: MediaItem, categoryId: number) => {
    try {
      await addItemsToCategory(categoryId, [item.id])
    } catch (err) {
      console.error('addItemsToCategory failed:', err)
    }
  }, [addItemsToCategory])

  const handleReveal = useCallback(async (item: MediaItem) => {
    try {
      await window.api.revealInFolder(item.id)
    } catch (err) {
      console.error('revealInFolder failed:', err)
    }
  }, [])

  const handleDislike = useCallback(async (item: MediaItem) => {
    usePanelRecommendationsStore.setState((s) => ({
      items: s.items.filter((it) => it.id !== item.id)
    }))
    try {
      await window.api.setDisliked(item.id, true)
    } catch (err) {
      console.error('setDisliked failed:', err)
    }
  }, [])

  const handleContextMenu = useCallback((e: React.MouseEvent, item: MediaItem) => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, item })
  }, [])

  const menuItems: ContextMenuItem[] = menu
    ? [
        {
          key: 'like',
          label: menu.item.liked ? '取消喜欢' : '喜欢',
          icon: menu.item.liked ? HeartOff : Heart,
          onClick: () => void handleLikeToggle(menu.item)
        },
        {
          key: 'reveal',
          label: '在文件管理器中显示',
          icon: FolderOpen,
          onClick: () => void handleReveal(menu.item)
        },
        ...(categories.length > 0
          ? ([
              { key: 'div-cat', divider: true },
              { key: 'h-cat', header: true, label: '添加到分类' },
              ...categories.map<ContextMenuItem>((c) => ({
                key: `cat-${c.id}`,
                label: c.name,
                icon: Folder,
                onClick: () => void handleAddToCategory(menu.item, c.id)
              }))
            ] as ContextMenuItem[])
          : []),
        { key: 'div-end', divider: true },
        {
          key: 'dislike',
          label: '不感兴趣',
          icon: EyeOff,
          danger: true,
          onClick: () => void handleDislike(menu.item)
        }
      ]
    : []

  return (
    <aside
      className={clsx(
        'relative flex-shrink-0 h-full overflow-hidden',
        isLight
          ? 'bg-secondary border-l border-border'
          : 'bg-black/40 backdrop-blur-md border-l border-white/10',
        'transition-[width] duration-[250ms] ease-out'
      )}
      style={{ width: open ? PANEL_WIDTH : 0 }}
      aria-hidden={!open}
      onWheel={(e) => e.stopPropagation()}
    >
      <div className="h-full flex flex-col" style={{ width: PANEL_WIDTH }}>
        <div className="flex-1 overflow-y-auto px-3 py-3 scroll-smooth">
          <div className="grid grid-cols-2 gap-2.5">
            {items.map((item) => (
              <RecommendationItem
                key={item.id}
                item={item}
                onOpen={() => detailOpen(item)}
                onLikeToggle={() => void handleLikeToggle(item)}
                onContextMenu={(e) => handleContextMenu(e, item)}
              />
            ))}
          </div>
          {items.length > 0 && <div ref={bottomRef} className="h-1" />}
        </div>
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems}
          onClose={() => setMenu(null)}
        />
      )}
    </aside>
  )
}

function RecommendationItem({
  item,
  onOpen,
  onLikeToggle,
  onContextMenu,
}: {
  item: MediaItem
  onOpen: () => void
  onLikeToggle: () => void
  onContextMenu: (e: React.MouseEvent) => void
}): React.JSX.Element {
  const [hovered, setHovered] = useState(false)
  const [imgError, setImgError] = useState(false)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  const liked = !!item.liked
  const isVideo = item.type === 'video'

  return (
    <div
      className={clsx(
        'relative w-full overflow-hidden rounded-md cursor-pointer select-none',
        'transition-[opacity,transform] duration-200 ease-out',
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1'
      )}
      style={{ aspectRatio: '3 / 4' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onOpen}
      onContextMenu={(e) => { e.preventDefault(); onContextMenu(e) }}
    >
      {imgError ? (
        <div className="absolute inset-0 flex items-center justify-center text-[11px] text-muted-foreground bg-foreground/[0.05]">
          加载失败
        </div>
      ) : (
        <img
          src={`serendip://thumb/${item.id}`}
          alt=""
          loading="lazy"
          draggable={false}
          className="absolute inset-0 w-full h-full object-cover"
          onError={() => setImgError(true)}
        />
      )}

      {/* hover 底部渐变遮罩 */}
      <div
        className={clsx(
          'absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent transition-opacity',
          hovered ? 'opacity-100' : 'opacity-0'
        )}
      />

      {/* 爱心按钮 bottom-left */}
      <button
        onClick={(e) => { e.stopPropagation(); onLikeToggle() }}
        className={clsx(
          'absolute bottom-1.5 left-1.5 p-1.5 rounded-full backdrop-blur transition-all',
          hovered || liked ? 'opacity-100' : 'opacity-0',
          liked
            ? 'bg-pink-500/90 text-white'
            : 'bg-black/40 text-white hover:bg-pink-500/80'
        )}
      >
        <Heart className={clsx('w-3.5 h-3.5', liked && 'fill-current')} />
      </button>

      {/* 三点菜单 top-left */}
      <button
        onClick={(e) => { e.stopPropagation(); onContextMenu(e) }}
        className={clsx(
          'absolute top-1.5 left-1.5 p-1 rounded-full bg-black/40 backdrop-blur text-white transition-opacity',
          hovered ? 'opacity-100' : 'opacity-0'
        )}
      >
        <MoreVertical className="w-3.5 h-3.5" />
      </button>

      {/* 视频徽章（渲染在最顶层，始终可见） */}
      {isVideo && !imgError && (
        <>
          <div className="absolute top-1.5 right-1.5 grid place-items-center w-6 h-6 rounded-full bg-black/55 backdrop-blur">
            <Play className="w-3 h-3 text-white fill-white" />
          </div>
          {item.duration_ms && (
            <div className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 text-[10px] leading-none bg-black/60 backdrop-blur rounded text-white tabular-nums">
              {formatDuration(item.duration_ms)}
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** mm:ss 格式化（毫秒 → 时长） */
function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

/**
 * 面包屑组件：显示当前图从 rootPath 起的各级目录，可点击收窄/扩大抽样范围。
 *
 * - rootPath 以上的部分（如盘符、系统路径）灰掉、不可点
 * - rootPath 本身作为根节点可点（收窄到全局范围 = null）
 * - 当前 scopePath 对应的 segment 高亮
 * - 点击某段 → setScope 切换，接力流随之刷新
 */
function Breadcrumb({
  item,
  rootPath,
  scopePath,
  onSetScope,
}: {
  item: MediaItem
  rootPath: string | null
  scopePath: string | null
  onSetScope: (path: string | null) => void
}): React.JSX.Element | null {
  if (!rootPath) return null

  // 统一用正斜杠做处理，最终显示保留原始 segment 文本
  const normalize = (p: string): string => p.replace(/\\/g, '/')
  const normRoot = normalize(rootPath).replace(/\/$/, '')
  const normFolder = normalize(item.folder_path).replace(/\/$/, '')

  // rootPath 以上的段（只展示，灰化不可点）
  const rootParts = normRoot.split('/').filter(Boolean)
  // rootPath 以下的相对段
  const relPath = normFolder.startsWith(normRoot)
    ? normFolder.slice(normRoot.length).replace(/^\//, '')
    : ''
  const relParts = relPath ? relPath.split('/').filter(Boolean) : []

  // 重建每段对应的绝对路径（用原始分隔符）
  const sep = rootPath.includes('\\') ? '\\' : '/'
  // 根节点路径 = rootPath（无末尾斜杠）
  const rootSegPath = rootPath.replace(/[/\\]$/, '')

  // 构建每个 relPart 的累积绝对路径
  const relAbsPaths: string[] = relParts.map((_, i) => {
    const sub = relParts.slice(0, i + 1).join(sep)
    return rootSegPath + sep + sub
  })

  const normScopePath = scopePath ? normalize(scopePath).replace(/\/$/, '') : null

  return (
    <div className="flex items-center flex-wrap gap-0 min-w-0 text-lg select-none">
      {/* rootPath 以上：灰化、半透、不可点、不加粗 */}
      {rootParts.map((seg, i) => (
        <span key={`above-${i}`} className="flex items-center">
          <span className="font-normal text-foreground/30 px-1">{seg}</span>
          <ChevronRight className="w-4 h-4 text-foreground/25 flex-shrink-0" />
        </span>
      ))}

      {/* rootPath 本身：可点（scope = null 表示全局范围） */}
      {(() => {
        const isActive = normScopePath === normRoot
        return (
          <span className="flex items-center">
            <button
              onClick={() => onSetScope(rootSegPath)}
              onDoubleClick={(e) => { e.stopPropagation(); void window.api.openFolder(rootSegPath) }}
              onAuxClick={(e) => { if (e.button === 1) { e.stopPropagation(); void window.api.openFolder(rootSegPath) } }}
              className={clsx(
                'px-1 py-0.5 rounded font-semibold transition-colors focus:outline-none focus-visible:outline-none',
                isActive ? 'text-primary' : 'text-foreground/85 hover:text-foreground'
              )}
            >
              {rootParts[rootParts.length - 1] ?? rootSegPath}
            </button>
            {relParts.length > 0 && (
              <ChevronRight className="w-4 h-4 text-foreground/30 flex-shrink-0" />
            )}
          </span>
        )
      })()}

      {/* rootPath 以下各级：可点 */}
      {relParts.map((seg, i) => {
        const absPath = relAbsPaths[i]
        const normAbs = normalize(absPath).replace(/\/$/, '')
        const isActive = normScopePath === normAbs
        return (
          <span key={`rel-${i}`} className="flex items-center">
            <button
              onClick={() => onSetScope(absPath)}
              onDoubleClick={(e) => { e.stopPropagation(); void window.api.openFolder(absPath) }}
              onAuxClick={(e) => { if (e.button === 1) { e.stopPropagation(); void window.api.openFolder(absPath) } }}
              className={clsx(
                'px-1 py-0.5 rounded font-semibold transition-colors focus:outline-none focus-visible:outline-none',
                isActive ? 'text-primary' : 'text-foreground/85 hover:text-foreground'
              )}
            >
              {seg}
            </button>
            <ChevronRight className="w-4 h-4 text-foreground/30 flex-shrink-0" />
          </span>
        )
      })}

      {/* 文件名（leaf，仅展示，不可点、不加粗、半透） */}
      {(() => {
        const filename = item.path.replace(/\\/g, '/').split('/').pop() ?? ''
        return (
          <span className="font-normal text-foreground/40 px-1">{filename}</span>
        )
      })()}
    </div>
  )
}
