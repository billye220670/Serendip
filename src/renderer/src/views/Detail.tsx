import { useEffect, useRef, useState, useCallback } from 'react'
import { ArrowLeft, ImageOff, VideoOff } from 'lucide-react'
import clsx from 'clsx'
import { useDetailStore, BUFFER_SIZE } from '../stores/detail'
import type { MediaItem } from '../../../main/recommender'

/**
 * 详情页（沉浸欣赏页）—— 全屏 fixed overlay（z-50），底层瀑布流不销毁。
 * 阶段 2：滚轮/键盘切换 + 接力队列 + j 圆点 + 切图转场 + 预加载。
 */
export function DetailView(): React.JSX.Element | null {
  const isOpen = useDetailStore((s) => s.isOpen)
  const sequence = useDetailStore((s) => s.sequence)
  const cursor = useDetailStore((s) => s.cursor)
  const close = useDetailStore((s) => s.close)
  const next = useDetailStore((s) => s.next)
  const prev = useDetailStore((s) => s.prev)
  const jumpTo = useDetailStore((s) => s.jumpTo)

  const currentItem = sequence[cursor] ?? null

  // 转场：isOpen 变化后延一帧驱动 CSS opacity/transform
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (isOpen) {
      const raf = requestAnimationFrame(() => setVisible(true))
      return () => cancelAnimationFrame(raf)
    } else {
      setVisible(false)
    }
  }, [isOpen])

  // 打开时锁定 body 滚动，防止滚轮穿透到底层瀑布流
  useEffect(() => {
    if (isOpen) {
      const prev = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = prev }
    }
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

  // 键盘：Esc / ↑↓ / 空格
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { close(); return }
      if (e.key === 'ArrowDown' || e.key === ' ') { e.preventDefault(); next() }
      else if (e.key === 'ArrowUp') { e.preventDefault(); prev() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, close, next, prev])

  if (!isOpen && !visible) return null
  if (!currentItem) return null

  return (
    <div
      className={clsx(
        'fixed inset-0 z-50 bg-black flex flex-col items-center justify-center',
        'transition-opacity duration-300',
        visible ? 'opacity-100' : 'opacity-0'
      )}
      onWheel={handleWheel}
    >
      {/* 后退按钮 */}
      <button
        onClick={close}
        className="absolute top-4 left-4 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm transition-colors backdrop-blur-sm"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>后退</span>
      </button>

      {/* 内容区（瞬切，无位移动效） */}
      <div className="w-full h-full flex items-center justify-center">
        {currentItem.type === 'video' ? (
          <VideoPlayer item={currentItem} />
        ) : (
          <ImageViewer item={currentItem} />
        )}
      </div>

      {/* 底部缩略图条 */}
      <ThumbStrip sequence={sequence} cursor={cursor} jumpTo={jumpTo} />

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
const THUMB_W_PX = 40
const THUMB_GAP_PX = 6

function ThumbStrip({
  sequence,
  cursor,
  jumpTo,
}: {
  sequence: MediaItem[]
  cursor: number
  jumpTo: (index: number) => void
}): React.JSX.Element | null {
  const currentItem = sequence[cursor] ?? null

  type Phase = 'entering' | 'in' | 'leaving'
  type Entry = { id: number; phase: Phase }

  const [entries, setEntries] = useState<Entry[]>(() =>
    currentItem ? [{ id: currentItem.id, phase: 'in' }] : []
  )

  // 每次 currentItem 变化，把它纳入条目（顺序：保留已有 + 当前在最右）
  useEffect(() => {
    if (!currentItem) return
    setEntries((prev) => {
      const aliveIds = new Set(prev.filter((e) => e.phase !== 'leaving').map((e) => e.id))
      let next: Entry[] = prev

      if (!aliveIds.has(currentItem.id)) {
        next = [...prev, { id: currentItem.id, phase: 'entering' }]
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
  }, [currentItem])

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

  if (!currentItem) return null

  // 通过 id 反查 sequence 中的下标（用于点击跳转）
  const idToIndex = new Map<number, number>()
  for (let i = 0; i < sequence.length; i++) idToIndex.set(sequence[i].id, i)

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex z-10">
      {entries.map(({ id, phase }) => {
        const isCurrent = id === currentItem.id
        const collapsed = phase === 'entering' || phase === 'leaving'
        const targetIndex = idToIndex.get(id)
        return (
          <button
            key={id}
            onClick={() => {
              if (phase !== 'in') return
              if (targetIndex !== undefined) jumpTo(targetIndex)
            }}
            className="thumb-strip-item h-10 rounded focus:outline-none"
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
                prev.filter((x) => !(x.id === id && x.phase === 'leaving'))
              )
            }}
          >
            <div
              className={clsx(
                'w-full h-full rounded overflow-hidden transition-opacity duration-200',
                isCurrent
                  ? 'opacity-100 ring-2 ring-white ring-offset-1 ring-offset-black/50'
                  : 'opacity-35 hover:opacity-60'
              )}
            >
              <img
                src={`serendip://thumb/${id}`}
                alt=""
                className="w-full h-full object-cover"
                draggable={false}
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
  sequence: MediaItem[]
  cursor: number
}): React.JSX.Element {
  const preloadItems = sequence.slice(cursor + 1, cursor + 3)
  return (
    <div className="sr-only" aria-hidden>
      {preloadItems.map((item) =>
        item.type === 'image' ? (
          <img
            key={item.id}
            src={`serendip://image/${item.id}`}
            alt=""
          />
        ) : null
      )}
    </div>
  )
}
