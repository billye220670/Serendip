import { useState, useRef, useCallback, useEffect, memo } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { Heart, MoreVertical, Play, Check, Presentation, ChevronUp } from 'lucide-react'
import clsx from 'clsx'
import type { MediaItem } from '../../../main/recommender'
import { useSelectionStore, type SelectMods } from '../stores/selection'
import { useCurrentCanvasStore } from '../stores/currentCanvas'
import { useCanvasesStore } from '../stores/canvases'
import { pushCanvasToast } from './Toast'
import { CanvasPicker } from './CanvasPicker'
import { Tooltip } from './Tooltip'

interface MediaCardProps {
  item: MediaItem
  onLikeToggle: (id: number, liked: boolean) => void
  onContextMenu?: (e: React.MouseEvent, item: MediaItem) => void
  /** 缩略图加载失败时的回调（用于上报到主进程并从列表移除） */
  onThumbError?: (item: MediaItem) => void
  /** 启用拖拽 — 用于把媒体拖到侧栏分类。默认开启 */
  draggable?: boolean
  /** 多选点击（Ctrl/Shift/多选模式下的单击）。视图负责区间计算 */
  onSelectClick?: (item: MediaItem, mods: SelectMods) => void
  /** 长按进入多选 */
  onLongPress?: (item: MediaItem) => void
  /** 普通单击（非多选、无修饰键）打开详情页 */
  onOpenDetail?: (item: MediaItem) => void
}
const LONG_PRESS_MS = 500 // 长按进入多选的阈值
const MOVE_CANCEL_PX = 8 // 移动超过此距离即取消长按（与拖拽阈值一致）

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

function MediaCardImpl({
  item,
  onLikeToggle,
  onContextMenu,
  onThumbError,
  draggable = true,
  onSelectClick,
  onLongPress,
  onOpenDetail
}: MediaCardProps): React.JSX.Element {
  const [hovered, setHovered] = useState(false)
  const [shouldPlayVideo, setShouldPlayVideo] = useState(false)
  const [videoFailed, setVideoFailed] = useState(false)
  const [imgError, setImgError] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const enterTimerRef = useRef<number | null>(null)
  const leaveTimerRef = useRef<number | null>(null)

  // 多选状态：卡片自身订阅，避免把 selected/active 透传到瀑布流 render 触发整列表重渲染
  const selected = useSelectionStore((s) => s.selected.has(item.id))
  const selectionActive = useSelectionStore((s) => s.active)

  // 画布相关状态
  const currentCanvasId = useCurrentCanvasStore((s) => s.currentCanvasId)
  const setCurrentCanvas = useCurrentCanvasStore((s) => s.setCurrent)
  const canvases = useCanvasesStore((s) => s.canvases)
  const addItemsToCanvas = useCanvasesStore((s) => s.addItems)
  const [canvasPicker, setCanvasPicker] = useState<{ x: number; y: number; placement: 'top' | 'bottom' } | null>(null)
  const capsuleRef = useRef<HTMLDivElement | null>(null)
  const pickerTriggerRef = useRef<HTMLButtonElement | null>(null)

  // 长按检测：与拖拽共存。pointerdown 起计时，移动超阈值或松手即取消；
  // 触发后用 ref 标记，抑制随后的 click，避免再次切换选中
  const longPressTimerRef = useRef<number | null>(null)
  const longPressFiredRef = useRef(false)
  const pressStartRef = useRef<{ x: number; y: number } | null>(null)

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

  const cancelLongPress = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
    pressStartRef.current = null
  }, [])

  // 卸载时清理所有定时器
  useEffect(() => {
    return () => {
      if (enterTimerRef.current !== null) window.clearTimeout(enterTimerRef.current)
      if (leaveTimerRef.current !== null) window.clearTimeout(leaveTimerRef.current)
      if (longPressTimerRef.current !== null) window.clearTimeout(longPressTimerRef.current)
    }
  }, [])

  // 滚动时关闭画布选择器
  useEffect(() => {
    if (!canvasPicker) return
    const handleScroll = (): void => {
      setCanvasPicker(null)
    }
    window.addEventListener('scroll', handleScroll, true)
    return () => {
      window.removeEventListener('scroll', handleScroll, true)
    }
  }, [canvasPicker])

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

  const handleAddToCanvas = useCallback(
    async (e: React.MouseEvent): Promise<void> => {
      e.stopPropagation()

      // 无当前画布：自动新建
      if (currentCanvasId === null) {
        let baseName = '新画布'
        let finalName = baseName
        let counter = 1
        while (canvases.some((c) => c.name === finalName)) {
          finalName = `${baseName} ${counter}`
          counter++
        }
        try {
          const id = await window.api.createCanvas(finalName)
          await useCanvasesStore.getState().load()
          setCurrentCanvas(id)
          await addItemsToCanvas(id, [item.id])
          pushCanvasToast(id, finalName, 1)
        } catch (err) {
          console.error('Failed to auto-create canvas:', err)
        }
        return
      }

      // 有当前画布：直接加
      const canvas = canvases.find((c) => c.id === currentCanvasId)
      if (!canvas) return
      await addItemsToCanvas(currentCanvasId, [item.id])
      pushCanvasToast(currentCanvasId, canvas.name, 1)
    },
    [currentCanvasId, canvases, addItemsToCanvas, setCurrentCanvas, item.id]
  )

  const handleOpenPicker = useCallback((e: React.MouseEvent): void => {
    e.stopPropagation()
    if (canvasPicker) { setCanvasPicker(null); return }
    const r = capsuleRef.current?.getBoundingClientRect()
    if (!r) return
    const placement = r.top > window.innerHeight / 2 ? 'top' : 'bottom'
    setCanvasPicker({ x: r.right, y: placement === 'top' ? r.top : r.bottom, placement })
  }, [canvasPicker])

  const handleCanvasPickerSelect = useCallback(
    async (canvasId: number): Promise<void> => {
      setCanvasPicker(null)
      const canvas = canvases.find((c) => c.id === canvasId)
      if (!canvas) return
      await addItemsToCanvas(canvasId, [item.id])
      pushCanvasToast(canvasId, canvas.name, 1)
    },
    [canvases, addItemsToCanvas, item.id]
  )

  const handleCanvasPickerCreate = useCallback(
    async (name: string): Promise<void> => {
      setCanvasPicker(null)
      try {
        const id = await window.api.createCanvas(name)
        await useCanvasesStore.getState().load()
        await addItemsToCanvas(id, [item.id])
        pushCanvasToast(id, name, 1)
      } catch (err) {
        console.error('createCanvas failed:', err)
      }
    },
    [addItemsToCanvas, item.id]
  )

  const handleImgError = useCallback((): void => {
    setImgError(true)
    onThumbError?.(item)
  }, [item, onThumbError])

  // pointerdown：先交给 dnd-kit 保留拖拽激活，再起长按计时（仅左键）
  const handlePointerDown = useCallback(
    (e: React.PointerEvent): void => {
      dragListeners?.onPointerDown?.(e)
      if (e.button !== 0) return
      longPressFiredRef.current = false
      pressStartRef.current = { x: e.clientX, y: e.clientY }
      if (longPressTimerRef.current !== null) window.clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = window.setTimeout(() => {
        longPressFiredRef.current = true
        longPressTimerRef.current = null
        onLongPress?.(item)
      }, LONG_PRESS_MS)
    },
    [dragListeners, item, onLongPress]
  )

  // 移动超过阈值（开始拖拽 / 滑动）就取消长按
  const handlePointerMove = useCallback(
    (e: React.PointerEvent): void => {
      const start = pressStartRef.current
      if (!start || longPressTimerRef.current === null) return
      if (
        Math.abs(e.clientX - start.x) > MOVE_CANCEL_PX ||
        Math.abs(e.clientY - start.y) > MOVE_CANCEL_PX
      ) {
        cancelLongPress()
      }
    },
    [cancelLongPress]
  )

  // 单击：多选模式或带修饰键时进入选择逻辑；长按刚触发则吞掉本次 click
  const handleClick = useCallback(
    (e: React.MouseEvent): void => {
      if (longPressFiredRef.current) {
        longPressFiredRef.current = false
        e.preventDefault()
        return
      }
      // 如果按下位置和松开位置有明显偏移（触控板轻扫），不触发详情
      if (pressStartRef.current) {
        const dx = e.clientX - pressStartRef.current.x
        const dy = e.clientY - pressStartRef.current.y
        if (Math.abs(dx) > MOVE_CANCEL_PX || Math.abs(dy) > MOVE_CANCEL_PX) return
      }
      const mods: SelectMods = { ctrlOrMeta: e.ctrlKey || e.metaKey, shift: e.shiftKey }
      if (selectionActive || mods.ctrlOrMeta || mods.shift) {
        e.preventDefault()
        onSelectClick?.(item, mods)
        return
      }
      // 普通单击：打开详情页
      onOpenDetail?.(item)
    },
    [selectionActive, item, onSelectClick, onOpenDetail]
  )

  const thumbUrl = `serendip://thumb/${item.id}`

  return (
    <div
      ref={setDragRef}
      {...dragAttributes}
      className={clsx(
        'relative group rounded-lg overflow-hidden bg-muted cursor-pointer w-full h-full select-none outline-none focus:outline-none focus-visible:outline-none',
        'transition-[opacity,filter] duration-200',
        isDragHovering && 'opacity-50',
        selected && 'ring-2 ring-primary ring-inset',
        selectionActive && !selected && 'opacity-35 saturate-50'
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={cancelLongPress}
      onPointerCancel={cancelLongPress}
      onClick={handleClick}
      onMouseEnter={handleHoverStart}
      onMouseLeave={() => {
        cancelLongPress()
        handleHoverEnd()
      }}
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
        onPointerDown={(e) => e.stopPropagation()}
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

      {/* 加入画布胶囊按钮（非多选模式可见） */}
      {!selectionActive && (
        <div
          ref={capsuleRef}
          className={clsx(
            'absolute bottom-2 right-2 flex items-center rounded-full backdrop-blur bg-black/40 text-white overflow-hidden transition-opacity',
            hovered ? 'opacity-100' : 'opacity-0'
          )}
        >
          {/* 左半：加入当前画布 / 自动创建 */}
          <Tooltip text={currentCanvasId ? '加入当前画布' : '新建画布并加入'}>
            <button
              onClick={(e) => { void handleAddToCanvas(e) }}
              onPointerDown={(e) => e.stopPropagation()}
              className="px-2.5 py-2 hover:bg-primary/80 transition-colors"
            >
              <Presentation className="w-4 h-4" />
            </button>
          </Tooltip>
          {/* 分隔线 */}
          <div className="w-px h-4 bg-white/20 flex-shrink-0" />
          {/* 右半：展开画布选择器 */}
          <Tooltip text="选择画布">
            <button
              ref={pickerTriggerRef}
              onClick={handleOpenPicker}
              onPointerDown={(e) => e.stopPropagation()}
              className={clsx(
                'px-2 py-2 transition-colors',
                canvasPicker ? 'bg-primary/80 text-white' : 'hover:bg-primary/80'
              )}
            >
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
        </div>
      )}

      {/* 画布 picker */}
      {canvasPicker && (
        <CanvasPicker
          x={canvasPicker.x}
          y={canvasPicker.y}
          placement={canvasPicker.placement}
          alignRight
          triggerRef={pickerTriggerRef}
          canvases={canvases}
          onSelect={(id) => { void handleCanvasPickerSelect(id) }}
          onCreateAndSelect={(name) => { void handleCanvasPickerCreate(name) }}
          onClose={() => setCanvasPicker(null)}
        />
      )}

      {/* 多选复选框：仅多选模式常显，pointer-events-none 让点击落到卡片以切换选中。
          不加 z 抬层，否则会越过 header 的 sticky 层级盖在顶栏之上 */}
      {selectionActive && (
        <div
          className={clsx(
            'absolute top-2 left-2 w-5 h-5 rounded-full flex items-center justify-center border-2 transition-colors pointer-events-none',
            selected
              ? 'bg-primary border-primary text-white'
              : 'bg-black/40 border-white/80 backdrop-blur'
          )}
        >
          {selected && <Check className="w-3 h-3" strokeWidth={3} />}
        </div>
      )}

      {/* 更多操作按钮：多选模式下隐藏（右键菜单仍可用） */}
      {!selectionActive && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onContextMenu?.(e, item)
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className={clsx(
            'absolute top-2 left-2 p-2 rounded-full bg-black/40 backdrop-blur text-white transition-opacity',
            hovered ? 'opacity-100' : 'opacity-0'
          )}
        >
          <MoreVertical className="w-4 h-4" />
        </button>
      )}
    </div>
  )
}

/**
 * 包 memo：瀑布流重排（如侧栏折叠动画 / 列宽变化）会让父级 render.photo 反复执行，
 * 但卡片的 props（item + 各回调）都稳定，memo 可挡掉这些无谓重渲。
 * 宽高只作用在外层定位 div 上，不进卡片，所以不会破坏 memo。
 */
export const MediaCard = memo(MediaCardImpl)

function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}
