import { useEffect, useRef, useState, useCallback } from 'react'
import { useInView } from 'react-intersection-observer'
import { ChevronLeft, ImageOff, VideoOff, ChevronRight, PanelRightOpen, PanelRightClose, Play } from 'lucide-react'
import clsx from 'clsx'
import { useDetailStore, BUFFER_SIZE, type SeqEntry } from '../stores/detail'
import { useLibraryStore } from '../stores/library'
import { useUIStore } from '../stores/ui'
import { usePanelRecommendationsStore } from '../stores/panelRecommendations'
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

  const currentItem = sequence[cursor]?.item ?? null
  const resetPanel = usePanelRecommendationsStore((s) => s.reset)
  const destroyPanel = usePanelRecommendationsStore((s) => s.destroy)

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
      if (e.key === 'Escape') { close(); return }
      if (e.key === 'Tab') { e.preventDefault(); togglePanel(); return }
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); next() }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); prev() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, close, next, prev, togglePanel])

  if (!isOpen && !visible) return null
  if (!currentItem) return null

  return (
    <div
      className={clsx(
        'fixed inset-0 z-50 bg-black flex flex-row',
        'transition-opacity duration-300',
        visible ? 'opacity-100' : 'opacity-0'
      )}
      onWheel={handleWheel}
    >
      {/* 左区（主舞台）：relative 让顶栏渐变 / 顶栏 / 缩略图条以 absolute 锚到左区。
          flex-1 + min-w-0 让右侧面板挤压时宽度自然让出 */}
      <div className="relative flex-1 min-w-0 flex flex-col items-center justify-center">
        {/* 顶部黑色渐变遮罩：从顶部向下淡出，提升面包屑/按钮在亮图上的可读性 */}
        <div className="absolute top-0 left-0 right-0 h-28 z-10 pointer-events-none bg-gradient-to-b from-black/75 via-black/40 to-transparent" />

        {/* 顶栏：后退 + 面包屑 + 面板开关。right-0 即左区右边界，按钮自然贴近面板 */}
        <div className="absolute top-0 left-0 right-0 z-10 flex items-center gap-3 px-4 py-3">
          <button
            onClick={close}
            aria-label="后退"
            className="flex-shrink-0 grid place-items-center w-11 h-11 rounded-full bg-black/45 hover:bg-black/65 text-white transition-colors focus:outline-none focus-visible:outline-none"
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
            className="flex-shrink-0 grid place-items-center w-11 h-11 rounded-full bg-black/45 hover:bg-black/65 text-white transition-colors focus:outline-none focus-visible:outline-none"
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
      <div className="flex flex-col items-center gap-3 text-white/60">
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
      <div className="flex flex-col items-center gap-3 text-white/60">
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
 * 内容：双列 grid，每张卡固定 3:4，图片用 absolute inset-0 + object-cover 充满，
 *      因此「占位骨架」与「真实卡片」尺寸完全一致 —— 防抖刷新瞬间整面板的占位先以
 *      shimmer 显示，图片各自异步到位后再淡入。
 * 数据源：`sequence` 中 cursor 之后的项（与接力队列共享）。
 * 防抖：cursor 变化后延迟 REFRESH_DELAY 才把 next 切片提交到 displayed。
 *      首次打开 + 有数据时立即填充，避免「打开就空一段」。
 * 触底：useInView 末尾哨兵触发 prefetchMore() 追加更多。
 * 转场：用 width 而不是 visibility/卸载，保留内部 React 状态；overflow-hidden 让收
 *      起过程内容自然裁掉。
 */
/**
 * 右侧推荐面板（d） — 双列瀑布流（挤压布局）。
 *
 * 布局：作为顶层 flex 行的右侧子项，撑满全高；宽度由 open 切换 0 ↔ PANEL_WIDTH，
 *      整体大图区随之让出宽度。展开/收起走 width transition，250ms。
 * 内容：双列 grid，每张卡固定 3:4，图片用 absolute inset-0 + object-cover 充满。
 * 数据源：`sequence` 中 cursor 之后的项（与接力队列共享）。
 * 视觉：不再使用骨架占位 —— cursor 切换瞬间把 displayed 清空（面板真的空着），
 *      短防抖后填入 target，每张卡 mount 时自身做一次 fade+1px 上移（pop in）。
 *      图片到位由 <img onLoad> 各自淡入，本来就是一张张错峰出现，不需要再人工 stagger。
 *      没图就是真没图（不再骗用户「快来了」）。
 * 触底：useInView 末尾哨兵触发 prefetchMore() 追加更多。
 * 转场：用 width 而不是 visibility/卸载，保留内部 React 状态；overflow-hidden 让收
 *      起过程内容自然裁掉。
 */
const PANEL_WIDTH = 320 // 双列 + 间距 + 内边距下的舒适宽度

function RecommendationsPanel({
  open,
}: {
  open: boolean
}): React.JSX.Element {
  const items = usePanelRecommendationsStore((s) => s.items)
  const loadMore = usePanelRecommendationsStore((s) => s.loadMore)
  const detailOpen = useDetailStore((s) => s.open)

  // 触底加载
  const { ref: bottomRef, inView: bottomInView } = useInView({ rootMargin: '200px' })
  useEffect(() => {
    if (!open) return
    if (bottomInView) loadMore()
  }, [bottomInView, open, loadMore])

  return (
    <aside
      className={clsx(
        'relative flex-shrink-0 h-full overflow-hidden',
        'bg-black/40 backdrop-blur-md border-l border-white/10',
        'transition-[width] duration-[250ms] ease-out'
      )}
      style={{ width: open ? PANEL_WIDTH : 0 }}
      aria-hidden={!open}
      // 防滚轮穿透：面板内滚动只用于浏览推荐列表，不应触发外层切大图
      onWheel={(e) => e.stopPropagation()}
    >
      {/* 内层固定宽度，避免收起动画过程中 grid 列宽随父宽度抖动 */}
      <div className="h-full flex flex-col" style={{ width: PANEL_WIDTH }}>
        <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between flex-shrink-0">
          <span className="text-sm font-medium text-white/85">相关推荐</span>
          <span className="text-xs text-white/40 tabular-nums">
            {items.length > 0 ? `${items.length} 张` : ''}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-3 scroll-smooth">
          <div className="grid grid-cols-2 gap-2.5">
            {items.map((item) => (
              <RecommendationItem
                key={item.id}
                item={item}
                onClick={() => detailOpen(item)}
              />
            ))}
          </div>
          {items.length > 0 && <div ref={bottomRef} className="h-1" />}
        </div>
      </div>
    </aside>
  )
}

/** d 面板单卡：固定 3:4，缩略图 absolute 充满、onLoad 淡入；视频右上角 Play 角标 + 右下时长。
 *  小卡密度高 + 同屏多卡 + 用户视线在大图，刻意不做 hover-play —— 视频缩略图（webp）已经
 *  足够识别，避开主瀑布流踩过的 video 元素并发坑。
 *  容器自身 mount 后下一帧切到 visible，触发 fade+1px 上移 ——「pop in」效果。
 *  本地 webp 缩略图通常已被 OS 缓存，<img> 的 onLoad 几乎与 mount 同步，不会先看见空底色再看见图。
 */
function RecommendationItem({
  item,
  onClick,
}: {
  item: MediaItem
  onClick: () => void
}): React.JSX.Element {
  const [imgError, setImgError] = useState(false)
  // 容器进入动效：mount 后下一帧切到 visible，触发 transition
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(raf)
  }, [])
  const isVideo = item.type === 'video'

  return (
    <button
      onClick={onClick}
      className={clsx(
        'relative w-full overflow-hidden rounded-md hover:ring-2 hover:ring-white/40 focus:outline-none',
        'transition-[opacity,transform] duration-200 ease-out',
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1'
      )}
      style={{ aspectRatio: '3 / 4' }}
    >
      {imgError ? (
        <div className="absolute inset-0 flex items-center justify-center text-[11px] text-white/40 bg-white/5">
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
    </button>
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
          <span className="font-normal text-white/30 px-1">{seg}</span>
          <ChevronRight className="w-4 h-4 text-white/25 flex-shrink-0" />
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
                isActive ? 'text-primary' : 'text-white/85 hover:text-white'
              )}
            >
              {rootParts[rootParts.length - 1] ?? rootSegPath}
            </button>
            {relParts.length > 0 && (
              <ChevronRight className="w-4 h-4 text-white/30 flex-shrink-0" />
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
                isActive ? 'text-primary' : 'text-white/85 hover:text-white'
              )}
            >
              {seg}
            </button>
            <ChevronRight className="w-4 h-4 text-white/30 flex-shrink-0" />
          </span>
        )
      })}

      {/* 文件名（leaf，仅展示，不可点、不加粗、半透） */}
      {(() => {
        const filename = item.path.replace(/\\/g, '/').split('/').pop() ?? ''
        return (
          <span className="font-normal text-white/40 px-1">{filename}</span>
        )
      })()}
    </div>
  )
}
