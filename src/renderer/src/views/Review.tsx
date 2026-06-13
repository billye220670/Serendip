import { useCallback, useEffect, useRef, useState, forwardRef } from 'react'
import { Heart, X, SkipForward, Plus, Undo2, Loader2 } from 'lucide-react'
import clsx from 'clsx'
import { ContextMenu } from '../components/ContextMenu'
import { useCategoriesStore } from '../stores/categories'
import { useLibraryStore } from '../stores/library'
import type { MediaItem } from '../../../main/recommender'

type UndoAction =
  | { item: MediaItem; action: 'like' }
  | { item: MediaItem; action: 'dislike' }
  | { item: MediaItem; action: 'category'; categoryId: number }
  | { item: MediaItem; action: 'skip' }

const THRESHOLD_X = 100
const THRESHOLD_Y = 80
const BUFFER_FILL = 10
const LOW_WATER = 4

export function ReviewView(): React.JSX.Element {
  const rootPath = useLibraryStore((s) => s.rootPath)
  const categories = useCategoriesStore((s) => s.categories)
  const addItemsToCategory = useCategoriesStore((s) => s.addItems)
  const removeItemsFromCategory = useCategoriesStore((s) => s.removeItems)

  const [queue, setQueue] = useState<MediaItem[]>([])
  const [loading, setLoading] = useState(false)
  const [exhausted, setExhausted] = useState(false)
  const [reviewed, setReviewed] = useState(0)
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null)
  const [flyState, setFlyState] = useState<{ dx: number; dy: number } | null>(null)
  const [pickerAnchor, setPickerAnchor] = useState<{ x: number; y: number } | null>(null)
  const [noCatHint, setNoCatHint] = useState(false)

  const undoStackRef = useRef<UndoAction[]>([])
  const seenIdsRef = useRef(new Set<number>())
  const loadingRef = useRef(false)
  const flyingRef = useRef(false)
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const addBtnRef = useRef<HTMLButtonElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const noCatTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // rootPath 变更时重置所有评审状态
  useEffect(() => {
    if (!rootPath) return
    seenIdsRef.current = new Set()
    undoStackRef.current = []
    loadingRef.current = false
    flyingRef.current = false
    setQueue([])
    setExhausted(false)
    setReviewed(0)
    setDrag(null)
    setFlyState(null)
    setPickerAnchor(null)
    setNoCatHint(false)
  }, [rootPath])

  useEffect(() => {
    return () => {
      if (noCatTimerRef.current) clearTimeout(noCatTimerRef.current)
    }
  }, [])

  const fetchMore = useCallback(async () => {
    if (loadingRef.current || !rootPath) return
    loadingRef.current = true
    setLoading(true)
    try {
      const batch = await window.api.getRecommendations(BUFFER_FILL, 'balanced')
      const fresh = batch.filter((it) => it && !seenIdsRef.current.has(it.id))
      fresh.forEach((f) => seenIdsRef.current.add(f.id))
      if (fresh.length === 0) {
        setExhausted(true)
      } else {
        setQueue((q) => [...q, ...fresh])
      }
    } finally {
      loadingRef.current = false
      setLoading(false)
    }
  }, [rootPath])

  // 缓冲低水位补充
  useEffect(() => {
    if (!rootPath || queue.length >= LOW_WATER || exhausted || loadingRef.current) return
    void fetchMore()
  }, [rootPath, queue.length, exhausted, fetchMore])

  const currentItem = queue[0] ?? null
  const nextItem = queue[1] ?? null

  const advance = useCallback((entry: UndoAction) => {
    undoStackRef.current = [entry, ...undoStackRef.current].slice(0, 10)
    setReviewed((r) => r + 1)
    setQueue((q) => q.slice(1))
    setFlyState(null)
    setDrag(null)
    flyingRef.current = false
  }, [])

  const triggerFlyOut = useCallback(
    async (
      direction: 'right' | 'left' | 'up',
      ipc: () => Promise<unknown>,
      entry: UndoAction
    ) => {
      if (flyingRef.current) return
      flyingRef.current = true
      const targets: Record<string, { dx: number; dy: number }> = {
        right: { dx: 650, dy: -80 },
        left: { dx: -650, dy: -80 },
        up: { dx: 0, dy: -520 }
      }
      setFlyState(targets[direction])
      await Promise.all([ipc(), new Promise<void>((res) => setTimeout(res, 250))])
      advance(entry)
    },
    [advance]
  )

  const doLike = useCallback(async () => {
    if (!currentItem || flyingRef.current) return
    await triggerFlyOut(
      'right',
      () => window.api.setLiked(currentItem.id, true),
      { item: currentItem, action: 'like' }
    )
  }, [currentItem, triggerFlyOut])

  const doDislike = useCallback(async () => {
    if (!currentItem || flyingRef.current) return
    await triggerFlyOut(
      'left',
      () => window.api.setDisliked(currentItem.id, true),
      { item: currentItem, action: 'dislike' }
    )
  }, [currentItem, triggerFlyOut])

  const doSkip = useCallback(async () => {
    if (!currentItem || flyingRef.current) return
    await triggerFlyOut('left', () => Promise.resolve(), { item: currentItem, action: 'skip' })
  }, [currentItem, triggerFlyOut])

  const openCategoryPicker = useCallback(() => {
    if (!currentItem || flyingRef.current) return
    if (categories.length === 0) {
      if (noCatTimerRef.current) clearTimeout(noCatTimerRef.current)
      setNoCatHint(true)
      noCatTimerRef.current = setTimeout(() => setNoCatHint(false), 2500)
      return
    }
    if (addBtnRef.current) {
      const rect = addBtnRef.current.getBoundingClientRect()
      setPickerAnchor({ x: rect.left + rect.width / 2, y: rect.top })
    }
  }, [currentItem, categories])

  const doAddToCategory = useCallback(
    async (categoryId: number) => {
      if (!currentItem || flyingRef.current) return
      setPickerAnchor(null)
      await triggerFlyOut(
        'up',
        () => addItemsToCategory(categoryId, [currentItem.id]),
        { item: currentItem, action: 'category', categoryId }
      )
    },
    [currentItem, triggerFlyOut, addItemsToCategory]
  )

  const doUndo = useCallback(async () => {
    const [entry, ...rest] = undoStackRef.current
    if (!entry) return
    undoStackRef.current = rest
    if (entry.action === 'like') await window.api.setLiked(entry.item.id, false)
    else if (entry.action === 'dislike') await window.api.setDisliked(entry.item.id, false)
    else if (entry.action === 'category')
      await removeItemsFromCategory(entry.categoryId, [entry.item.id])
    setReviewed((r) => Math.max(0, r - 1))
    setExhausted(false)
    setQueue((q) => [entry.item, ...q])
  }, [removeItemsFromCategory])

  // 键盘快捷键
  useEffect(() => {
    const onKeyDown = async (e: KeyboardEvent): Promise<void> => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === 'Backspace') {
        e.preventDefault()
        await doUndo()
        return
      }
      if (pickerAnchor) return
      switch (e.key) {
        case 'ArrowRight':
          e.preventDefault()
          await doLike()
          break
        case 'ArrowLeft':
          e.preventDefault()
          await doDislike()
          break
        case 'ArrowUp':
          e.preventDefault()
          openCategoryPicker()
          break
        case ' ':
          e.preventDefault()
          await doSkip()
          break
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [pickerAnchor, doLike, doDislike, doSkip, doUndo, openCategoryPicker])

  // 指针/拖拽事件
  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (flyingRef.current) return
    cardRef.current?.setPointerCapture(e.pointerId)
    startRef.current = { x: e.clientX, y: e.clientY }
    setDrag({ dx: 0, dy: 0 })
  }, [])

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!startRef.current) return
    setDrag({ dx: e.clientX - startRef.current.x, dy: e.clientY - startRef.current.y })
  }, [])

  const onPointerUp = useCallback(
    async (e: React.PointerEvent<HTMLDivElement>) => {
      if (!startRef.current) return
      const dx = e.clientX - startRef.current.x
      const dy = e.clientY - startRef.current.y
      startRef.current = null
      setDrag(null)
      if (dx > THRESHOLD_X) {
        await doLike()
      } else if (dx < -THRESHOLD_X) {
        await doDislike()
      } else if (dy < -THRESHOLD_Y && Math.abs(dx) < 80) {
        openCategoryPicker()
      }
    },
    [doLike, doDislike, openCategoryPicker]
  )

  // ─── 空态 ───

  if (!rootPath) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
        请先选择根目录
      </div>
    )
  }

  if (loading && queue.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!loading && queue.length === 0 && exhausted) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <p className="text-xl font-semibold mb-2">暂时没有更多可评审的了</p>
          <p className="text-sm text-muted-foreground">
            过会儿再来，本次已评审 {reviewed} 张
          </p>
        </div>
      </div>
    )
  }

  // ─── 卡片动画计算 ───

  const dx = drag?.dx ?? 0
  const dy = drag?.dy ?? 0
  const isFly = flyState !== null
  const cardDx = isFly ? flyState.dx : dx
  const cardDy = isFly ? flyState.dy : dy
  const rotate = isFly ? (flyState.dx > 0 ? 25 : flyState.dx < 0 ? -25 : 0) : dx / 20
  const likeAlpha = Math.min(1, Math.max(0, (dx - 30) / 70))
  const nopeAlpha = Math.min(1, Math.max(0, (-dx - 30) / 70))
  const catAlpha = Math.min(1, Math.max(0, (-dy - 30) / 50))
  const canAct = !!currentItem && !isFly

  return (
    <div className="h-full flex flex-col items-center select-none overflow-hidden">
      {/* 顶部进度 */}
      <div className="mt-6 mb-2 text-sm text-muted-foreground min-h-[1.5rem]">
        {reviewed > 0 ? `已评审 ${reviewed} 张` : '开始评审'}
        {queue.length > 0 && ` · 还有约 ${queue.length} 张待判断`}
        {loading && queue.length > 0 && ' · 加载中'}
      </div>

      {/* 卡堆区 */}
      <div className="flex-1 flex items-center justify-center w-full relative min-h-0">
        {/* 下一张（底部略露，暗示还有更多） */}
        {nextItem && (
          <div
            className="absolute rounded-2xl overflow-hidden shadow-md bg-muted"
            style={{
              width: 'min(400px, 82vw)',
              height: 'min(520px, 68vh)',
              transform: 'scale(0.96) translateY(10px)',
              zIndex: 0,
              opacity: 0.6
            }}
          >
            <img
              src={`serendip://thumb/${nextItem.id}`}
              alt=""
              className="w-full h-full object-cover"
            />
          </div>
        )}

        {/* 当前卡 — key 变更时 React 重挂，新卡从原位置出现 */}
        {currentItem && (
          <div
            key={currentItem.id}
            ref={cardRef}
            className="relative rounded-2xl overflow-hidden shadow-2xl bg-background cursor-grab active:cursor-grabbing"
            style={{
              width: 'min(400px, 82vw)',
              height: 'min(520px, 68vh)',
              zIndex: 1,
              transform: `translateX(${cardDx}px) translateY(${cardDy}px) rotate(${rotate}deg)`,
              transition: isFly
                ? 'transform 0.2s ease-out, opacity 0.2s ease-out'
                : drag
                  ? 'none'
                  : 'transform 0.2s ease-out',
              opacity: isFly ? 0 : 1,
              touchAction: 'none',
              userSelect: 'none'
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => {
              startRef.current = null
              setDrag(null)
            }}
          >
            {/* LIKE 角标 */}
            <div
              className="absolute top-5 left-5 z-10 px-3 py-1 border-4 border-green-500 text-green-500 rounded-lg font-black text-2xl tracking-widest pointer-events-none"
              style={{ opacity: likeAlpha, transform: 'rotate(-12deg)' }}
            >
              LIKE
            </div>

            {/* NOPE 角标 */}
            <div
              className="absolute top-5 right-5 z-10 px-3 py-1 border-4 border-red-500 text-red-500 rounded-lg font-black text-2xl tracking-widest pointer-events-none"
              style={{ opacity: nopeAlpha, transform: 'rotate(12deg)' }}
            >
              NOPE
            </div>

            {/* 分类角标 */}
            <div
              className="absolute top-5 left-1/2 z-10 -translate-x-1/2 px-3 py-1 border-4 border-blue-500 text-blue-500 rounded-lg font-black text-xl tracking-widest pointer-events-none"
              style={{ opacity: catAlpha }}
            >
              ＋分类
            </div>

            {currentItem.type === 'video' ? (
              <video
                src={`serendip://video/${currentItem.id}`}
                autoPlay
                muted
                loop
                playsInline
                className="w-full h-full object-cover"
                style={{ pointerEvents: 'none' }}
              />
            ) : (
              <img
                src={`serendip://thumb/${currentItem.id}`}
                alt=""
                className="w-full h-full object-cover"
                draggable={false}
                style={{ pointerEvents: 'none' }}
              />
            )}
          </div>
        )}
      </div>

      {/* 无分类提示 */}
      <div className="h-5 flex items-center mb-1">
        {noCatHint && (
          <span className="text-xs text-muted-foreground">先在左侧新建一个分类</span>
        )}
      </div>

      {/* 底部按钮区：撤销 · 不感兴趣 · 跳过 · 加入分类 · 喜欢 */}
      <div className="mb-8 flex items-center gap-3">
        <ActionButton
          onClick={() => void doUndo()}
          disabled={undoStackRef.current.length === 0}
          title="撤销（Backspace）"
          size="sm"
        >
          <Undo2 className="w-4 h-4" />
        </ActionButton>

        <ActionButton
          onClick={() => void doDislike()}
          disabled={!canAct}
          title="不感兴趣（←）"
          color="red"
        >
          <X className="w-6 h-6" />
        </ActionButton>

        <ActionButton
          onClick={() => void doSkip()}
          disabled={!canAct}
          title="跳过（Space）"
          size="sm"
        >
          <SkipForward className="w-4 h-4" />
        </ActionButton>

        <ActionButton
          ref={addBtnRef}
          onClick={openCategoryPicker}
          disabled={!canAct}
          title="加入分类（↑）"
          color="blue"
        >
          <Plus className="w-6 h-6" />
        </ActionButton>

        <ActionButton
          onClick={() => void doLike()}
          disabled={!canAct}
          title="喜欢（→）"
          color="green"
        >
          <Heart className="w-6 h-6" />
        </ActionButton>
      </div>

      {/* 分类选择器 */}
      {pickerAnchor && (
        <ContextMenu
          x={pickerAnchor.x}
          y={pickerAnchor.y}
          placement="top"
          onClose={() => setPickerAnchor(null)}
          items={categories.map((cat) => ({
            key: String(cat.id),
            label: cat.name,
            onClick: () => void doAddToCategory(cat.id)
          }))}
        />
      )}
    </div>
  )
}

// ─── 底部操作按钮 ───

interface ActionButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  size?: 'sm' | 'md'
  color?: 'red' | 'green' | 'blue' | 'default'
}

const ActionButton = forwardRef<HTMLButtonElement, ActionButtonProps>(
  ({ onClick, disabled, title, size = 'md', color = 'default', children, ...rest }, ref) => {
    const sizeClass = size === 'sm' ? 'w-10 h-10' : 'w-14 h-14'
    const colorClass = {
      red: 'border-red-400 text-red-400 hover:bg-red-400/10 disabled:border-red-400/30 disabled:text-red-400/30',
      green:
        'border-green-400 text-green-400 hover:bg-green-400/10 disabled:border-green-400/30 disabled:text-green-400/30',
      blue: 'border-blue-400 text-blue-400 hover:bg-blue-400/10 disabled:border-blue-400/30 disabled:text-blue-400/30',
      default:
        'border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30'
    }[color]
    return (
      <button
        ref={ref}
        onClick={onClick}
        disabled={disabled}
        title={title}
        className={clsx(
          'flex items-center justify-center rounded-full border-2 transition-colors disabled:cursor-not-allowed',
          sizeClass,
          colorClass
        )}
        {...rest}
      >
        {children}
      </button>
    )
  }
)
ActionButton.displayName = 'ActionButton'
