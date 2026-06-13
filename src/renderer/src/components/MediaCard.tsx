import { useState, useRef, useCallback, useEffect } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { Heart, MoreVertical, Play } from 'lucide-react'
import clsx from 'clsx'
import type { MediaItem } from '../../../main/recommender'

interface MediaCardProps {
  item: MediaItem
  onLikeToggle: (id: number, liked: boolean) => void
  onContextMenu?: (e: React.MouseEvent, item: MediaItem) => void
  /** 缩略图加载失败时的回调（用于上报到主进程并从列表移除） */
  onThumbError?: (item: MediaItem) => void
  /** 启用拖拽 — 用于把媒体拖到侧栏分类。默认开启 */
  draggable?: boolean
}

const VIDEO_PLAY_LIMIT = 3 // 最多 3 个视频同时播放
const playingVideos = new Map<number, HTMLVideoElement>() // id → 元素引用

/**
 * 视频冷却记录：仅在视频明确触发 error 事件时进入冷却
 * 看门狗超时不进冷却，避免误伤大文件 / 慢 IO 的场景
 */
interface CooldownEntry {
  until: number
  failures: number
}
const videoCooldown = new Map<number, CooldownEntry>()
const BASE_COOLDOWN_MS = 10_000 // 10 秒
const MAX_COOLDOWN_MS = 60_000 // 1 分钟

function isInCooldown(id: number): boolean {
  const entry = videoCooldown.get(id)
  if (!entry) return false
  return Date.now() < entry.until
}

function enterCooldown(id: number): void {
  const prev = videoCooldown.get(id)
  const failures = (prev?.failures ?? 0) + 1
  // 缓和的退避：10s → 20s → 40s → 60s（封顶）
  const cooldownMs = Math.min(BASE_COOLDOWN_MS * Math.pow(2, failures - 1), MAX_COOLDOWN_MS)
  videoCooldown.set(id, {
    until: Date.now() + cooldownMs,
    failures
  })
  playingVideos.delete(id)
}

function clearCooldown(id: number): void {
  videoCooldown.delete(id)
}

function canPlayVideo(id: number, el: HTMLVideoElement): boolean {
  if (isInCooldown(id)) {
    return false
  }

  const existing = playingVideos.get(id)
  if (existing && existing !== el) {
    existing.pause()
    playingVideos.delete(id)
  }

  if (playingVideos.size < VIDEO_PLAY_LIMIT) {
    playingVideos.set(id, el)
    return true
  }

  return false
}

function releaseVideo(id: number, el: HTMLVideoElement): void {
  const existing = playingVideos.get(id)
  if (existing === el) {
    playingVideos.delete(id)
  }
}

export function MediaCard({
  item,
  onLikeToggle,
  onContextMenu,
  onThumbError,
  draggable = true
}: MediaCardProps): React.JSX.Element {
  const [hovered, setHovered] = useState(false)
  const [shouldPlayVideo, setShouldPlayVideo] = useState(false)
  const [videoFailed, setVideoFailed] = useState(false)
  const [imgError, setImgError] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const enterTimerRef = useRef<number | null>(null)
  const leaveTimerRef = useRef<number | null>(null)

  // dnd-kit：把媒体注册成可拖拽对象。activationConstraint 见 App 的 PointerSensor 配置，
  // 只有真正拖动 > 8px 才会触发，单击 / 右键 / hover 不受影响
  const {
    setNodeRef: setDragRef,
    attributes: dragAttributes,
    listeners: dragListeners,
    isDragging: isDragHovering
  } = useDraggable({
    id: `media-${item.id}`,
    data: { type: 'media', fileId: item.id, item },
    disabled: !draggable
  })

  // liked 直接以 props 为准（父级 setItems 后会自动同步）
  const liked = !!item.liked

  // 卸载时清理所有定时器
  useEffect(() => {
    return () => {
      if (enterTimerRef.current !== null) window.clearTimeout(enterTimerRef.current)
      if (leaveTimerRef.current !== null) window.clearTimeout(leaveTimerRef.current)
    }
  }, [])

  const handleHoverStart = useCallback(() => {
    setHovered(true)
    if (item.type === 'video') {
      // 取消可能存在的离开延迟（用户回头了，复用 video 元素）
      if (leaveTimerRef.current !== null) {
        window.clearTimeout(leaveTimerRef.current)
        leaveTimerRef.current = null
      }
      // 已经在播就不重置失败状态，让冷却控制
      if (!shouldPlayVideo) {
        setVideoFailed(false)
        // 延迟挂载：避免快速划过造成 video 元素抖动
        if (enterTimerRef.current !== null) {
          window.clearTimeout(enterTimerRef.current)
        }
        enterTimerRef.current = window.setTimeout(() => {
          setShouldPlayVideo(true)
          enterTimerRef.current = null
        }, 300)
      }
    }
  }, [item.type, shouldPlayVideo])

  const handleHoverEnd = useCallback(() => {
    setHovered(false)
    if (item.type !== 'video') return

    // 立即取消未触发的进入延迟
    if (enterTimerRef.current !== null) {
      window.clearTimeout(enterTimerRef.current)
      enterTimerRef.current = null
    }

    // 离开后延迟 250ms 才真正卸载 video 元素
    // 这段窗口内若用户回头 hover，会取消这个 timer，避免 mount/unmount 抖动
    if (leaveTimerRef.current !== null) {
      window.clearTimeout(leaveTimerRef.current)
    }
    leaveTimerRef.current = window.setTimeout(() => {
      setShouldPlayVideo(false)
      leaveTimerRef.current = null
    }, 250)
  }, [item.type])

  // 视频元素 mount/unmount 时管理播放槽位
  const handleVideoMount = useCallback(
    (el: HTMLVideoElement | null) => {
      if (el && item.type === 'video') {
        videoRef.current = el
        if (canPlayVideo(item.id, el)) {
          const playPromise = el.play()
          if (playPromise) {
            playPromise.catch(() => {
              /* AbortError 等：元素已被 unmount，无需处理 */
            })
          }
          // 8 秒看门狗：到时还没真正在播只标记本次失败，不进 cooldown
          // （区分大文件慢加载 vs 真正损坏的视频；真正损坏的会触发 onError）
          const watchdog = window.setTimeout(() => {
            if (el.readyState < 3 || el.paused) {
              console.warn(`Video ${item.id} did not start within 8s`)
              setVideoFailed(true)
              releaseVideo(item.id, el)
            }
          }, 8000)
          ;(el as HTMLVideoElement & { _watchdog?: number })._watchdog = watchdog
        } else {
          // 池满或冷却中
          setVideoFailed(true)
        }
      } else if (!el && videoRef.current && item.type === 'video') {
        const oldEl = videoRef.current
        const watchdog = (oldEl as HTMLVideoElement & { _watchdog?: number })._watchdog
        if (watchdog !== undefined) {
          window.clearTimeout(watchdog)
        }
        oldEl.pause()
        releaseVideo(item.id, oldEl)
        videoRef.current = null
      }
    },
    [item.id, item.type]
  )

  const handleVideoError = useCallback(() => {
    console.warn(`Video ${item.id} error event, entering cooldown`)
    enterCooldown(item.id)
    setVideoFailed(true)
  }, [item.id])

  const handleVideoPlaying = useCallback(() => {
    const el = videoRef.current
    if (el) {
      const watchdog = (el as HTMLVideoElement & { _watchdog?: number })._watchdog
      if (watchdog !== undefined) {
        window.clearTimeout(watchdog)
        ;(el as HTMLVideoElement & { _watchdog?: number })._watchdog = undefined
      }
    }
    clearCooldown(item.id)
  }, [item.id])

  const handleLikeClick = (e: React.MouseEvent): void => {
    e.stopPropagation()
    onLikeToggle(item.id, !liked)
  }

  const handleImgError = useCallback((): void => {
    setImgError(true)
    onThumbError?.(item)
  }, [item, onThumbError])

  const thumbUrl = `serendip://thumb/${item.id}`

  return (
    <div
      ref={setDragRef}
      {...dragAttributes}
      {...dragListeners}
      className={clsx(
        'relative group rounded-lg overflow-hidden bg-muted cursor-pointer w-full h-full',
        isDragHovering && 'opacity-50'
      )}
      onMouseEnter={handleHoverStart}
      onMouseLeave={handleHoverEnd}
      onContextMenu={(e) => onContextMenu?.(e, item)}
    >
      {/* 缩略图 / 视频封面 */}
      {!imgError ? (
        <img
          src={thumbUrl}
          alt=""
          loading="lazy"
          className="w-full h-full object-cover"
          onError={handleImgError}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">
          加载失败
        </div>
      )}

      {/* 视频静音循环播放（hover 250ms 后才挂载，避免快速划过触发） */}
      {item.type === 'video' && shouldPlayVideo && !videoFailed && (
        <video
          ref={handleVideoMount}
          src={`serendip://video/${item.id}`}
          muted
          loop
          autoPlay
          playsInline
          onError={handleVideoError}
          onPlaying={handleVideoPlaying}
          className="absolute inset-0 w-full h-full object-cover"
        />
      )}

      {/* 视频播放标识：仅在不显示视频元素时显示封面图标 */}
      {item.type === 'video' && (!shouldPlayVideo || videoFailed) && (
        <>
          <div className="absolute top-2 right-2 bg-black/60 backdrop-blur rounded-full p-1.5">
            <Play className="w-3 h-3 text-white fill-white" />
          </div>
          {item.duration_ms && (
            <div className="absolute bottom-2 right-2 px-1.5 py-0.5 text-xs bg-black/60 backdrop-blur rounded text-white">
              {formatDuration(item.duration_ms)}
            </div>
          )}
        </>
      )}

      {/* hover 遮罩 + 操作 */}
      <div
        className={clsx(
          'absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent transition-opacity',
          hovered ? 'opacity-100' : 'opacity-0'
        )}
      />
      <button
        onClick={handleLikeClick}
        className={clsx(
          'absolute bottom-2 left-2 p-2 rounded-full backdrop-blur transition-all',
          hovered || liked ? 'opacity-100' : 'opacity-0',
          liked
            ? 'bg-pink-500/90 text-white'
            : 'bg-black/40 text-white hover:bg-pink-500/80'
        )}
      >
        <Heart
          className={clsx('w-4 h-4', liked && 'fill-current')}
        />
      </button>

      <button
        onClick={(e) => {
          e.stopPropagation()
          onContextMenu?.(e, item)
        }}
        className={clsx(
          'absolute top-2 left-2 p-1.5 rounded-full bg-black/40 backdrop-blur text-white transition-opacity',
          hovered ? 'opacity-100' : 'opacity-0'
        )}
      >
        <MoreVertical className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}
