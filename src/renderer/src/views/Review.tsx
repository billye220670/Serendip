import { useCallback, useEffect, useRef, useState } from 'react'
import { Undo2, SkipForward, Loader2 } from 'lucide-react'
import clsx from 'clsx'
import { useCategoriesStore } from '../stores/categories'
import { useLibraryStore } from '../stores/library'
import type { MediaItem } from '../../../main/recommender'

type UndoAction =
  | { item: MediaItem; action: 'like' }
  | { item: MediaItem; action: 'dislike' }
  | { item: MediaItem; action: 'skip' }

const THRESHOLD_X = 100
const BUFFER_FILL = 10
const LOW_WATER = 4

export function ReviewView(): React.JSX.Element {
  const rootPath = useLibraryStore((s) => s.rootPath)
  const setReviewProgress = useLibraryStore((s) => s.setReviewProgress)
  const categories = useCategoriesStore((s) => s.categories)
  const addItemsToCategory = useCategoriesStore((s) => s.addItems)
  const removeItemsFromCategory = useCategoriesStore((s) => s.removeItems)

  const [queue, setQueue] = useState<MediaItem[]>([])
  const [loading, setLoading] = useState(false)
  const [exhausted, setExhausted] = useState(false)
  const [reviewed, setReviewed] = useState(0)
  const [drag, setDrag] = useState<{ dx: number } | null>(null)
  const [flyState, setFlyState] = useState<{ dx: number; dy: number } | null>(null)
  const [itemCategoryIds, setItemCategoryIds] = useState<Set<number>>(new Set())

  const undoStackRef = useRef<UndoAction[]>([])
  const seenIdsRef = useRef(new Set<number>())
  const loadingRef = useRef(false)
  const flyingRef = useRef(false)
  const startXRef = useRef<number | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)

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
    setItemCategoryIds(new Set())
  }, [rootPath])

  // 同步进度到顶部标题栏，卸载时清空
  useEffect(() => {
    setReviewProgress({ reviewed, pending: queue.length })
    return () => setReviewProgress(null)
  }, [reviewed, queue.length, setReviewProgress])

  const fetchMore = useCallback(async () => {
    if (loadingRef.current || !rootPath) return
    loadingRef.current = true
    setLoading(true)
    try {
      const batch = await window.api.getRecommendations(BUFFER_FILL, 'balanced', true)
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

  // 当前卡片变更时，加载其分类归属
  useEffect(() => {
    if (!currentItem) { setItemCategoryIds(new Set()); return }
    window.api.getFileCategoryIds(currentItem.id).then((ids) => {
      setItemCategoryIds(new Set(ids))
    })
  }, [currentItem?.id])

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
      direction: 'right' | 'left',
      ipc: () => Promise<unknown>,
      entry: UndoAction
    ) => {
      if (flyingRef.current) return
      flyingRef.current = true
      const targets = {
        right: { dx: 700, dy: -60 },
        left: { dx: -700, dy: -60 }
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

  const doUndo = useCallback(async () => {
    const [entry, ...rest] = undoStackRef.current
    if (!entry) return
    undoStackRef.current = rest
    if (entry.action === 'like') await window.api.setLiked(entry.item.id, false)
    else if (entry.action === 'dislike') await window.api.setDisliked(entry.item.id, false)
    setReviewed((r) => Math.max(0, r - 1))
    setExhausted(false)
    setQueue((q) => [entry.item, ...q])
  }, [])

  const toggleCategory = useCallback(
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

  // 键盘快捷键（移除了上滑 ArrowUp）
  useEffect(() => {
    const onKeyDown = async (e: KeyboardEvent): Promise<void> => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === 'Backspace') {
        e.preventDefault()
        await doUndo()
        return
      }
      switch (e.key) {
        case 'ArrowRight':
          e.preventDefault()
          await doLike()
          break
        case 'ArrowLeft':
          e.preventDefault()
          await doDislike()
          break
        case ' ':
          e.preventDefault()
          await doSkip()
          break
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [doLike, doDislike, doSkip, doUndo])

  // 指针事件（仅水平轴判定）
  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (flyingRef.current) return
    cardRef.current?.setPointerCapture(e.pointerId)
    startXRef.current = e.clientX
    setDrag({ dx: 0 })
  }, [])

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (startXRef.current === null) return
    setDrag({ dx: e.clientX - startXRef.current })
  }, [])

  const onPointerUp = useCallback(
    async (e: React.PointerEvent<HTMLDivElement>) => {
      if (startXRef.current === null) return
      const dx = e.clientX - startXRef.current
      startXRef.current = null
      setDrag(null)
      if (dx > THRESHOLD_X) await doLike()
      else if (dx < -THRESHOLD_X) await doDislike()
    },
    [doLike, doDislike]
  )

  // ─── 空态（early return）───

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
          <p className="text-sm text-muted-foreground">过会儿再来</p>
        </div>
      </div>
    )
  }

  // ─── 动画计算 ───

  const dx = drag?.dx ?? 0
  const isFly = flyState !== null
  const cardDx = isFly ? flyState.dx : dx
  const cardDy = isFly ? flyState.dy : 0
  const rotate = isFly ? (flyState.dx > 0 ? 22 : -22) : dx / 18
  const likeAlpha = Math.min(1, Math.max(0, (dx - 30) / 70))
  const nopeAlpha = Math.min(1, Math.max(0, (-dx - 30) / 70))

  return (
    <div className="relative h-full w-full select-none overflow-hidden">
      {/* 层 0 — 下一张卡（固定宽度，比例自适应高度，统一大小防止堆叠混乱） */}
      <div className="absolute inset-0 flex items-center justify-center" style={{ zIndex: 0 }}>
        {nextItem && (
          <div
            className="flex-shrink-0 rounded-3xl overflow-hidden"
            style={{ transform: 'scale(0.95) translateY(6px)', opacity: 0.75 }}
          >
            <img
              src={`serendip://thumb/${nextItem.id}`}
              alt=""
              draggable={false}
              style={{
                display: 'block',
                width: '720px',
                height: 'auto',
                maxWidth: 'calc(100vw - 320px)',
                pointerEvents: 'none',
                userSelect: 'none'
              }}
            />
          </div>
        )}
      </div>

      {/* 层 1 — 当前卡（overflow-hidden 裁剪飞出动画） */}
      <div
        className="absolute inset-0 flex items-center justify-center overflow-hidden"
        style={{ zIndex: 1 }}
      >
        {currentItem && (
          <div
            key={currentItem.id}
            ref={cardRef}
            className="card-enter relative flex-shrink-0 rounded-3xl overflow-hidden cursor-grab active:cursor-grabbing"
            style={{
              transform: `translateX(${cardDx}px) translateY(${cardDy}px) rotate(${rotate}deg)`,
              transition: isFly
                ? 'transform 0.22s ease-out, opacity 0.22s ease-out'
                : drag
                  ? 'none'
                  : 'transform 0.2s ease-out',
              opacity: isFly ? 0 : 1,
              touchAction: 'none'
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => {
              startXRef.current = null
              setDrag(null)
            }}
          >
            {/* 喜欢 印章 */}
            <div
              className="absolute top-8 left-8 z-10 font-black text-primary leading-none pointer-events-none"
              style={{
                opacity: likeAlpha,
                fontSize: '5rem',
                transform: 'rotate(-14deg)',
                textShadow: '0 2px 16px rgba(0,0,0,0.55)'
              }}
            >
              喜欢
            </div>

            {/* 不感兴趣 印章 */}
            <div
              className="absolute top-8 right-8 z-10 font-black leading-none pointer-events-none"
              style={{
                opacity: nopeAlpha,
                fontSize: '3rem',
                color: 'rgba(220,220,220,0.92)',
                transform: 'rotate(14deg)',
                textShadow: '0 2px 16px rgba(0,0,0,0.55)'
              }}
            >
              不感兴趣
            </div>

            {currentItem.type === 'video' ? (
              <video
                src={`serendip://video/${currentItem.id}`}
                autoPlay
                muted
                loop
                playsInline
                style={{
                  display: 'block',
                  height: 'calc(100vh - 160px)',
                  width: 'auto',
                  maxWidth: 'calc(100vw - 320px)',
                  pointerEvents: 'none'
                }}
              />
            ) : (
              <img
                src={`serendip://thumb/${currentItem.id}`}
                alt=""
                draggable={false}
                style={{
                  display: 'block',
                  height: 'calc(100vh - 160px)',
                  width: 'auto',
                  maxWidth: 'calc(100vw - 320px)',
                  pointerEvents: 'none',
                  userSelect: 'none'
                }}
              />
            )}
          </div>
        )}
      </div>

      {/* 撤销 — 左上角，大按钮，深色底 */}
      <button
        className="absolute top-8 left-8 z-20 p-3 rounded-full bg-black/50 text-white hover:bg-black/65 backdrop-blur-sm transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
        onClick={() => void doUndo()}
        disabled={undoStackRef.current.length === 0}
        title="撤销（Backspace）"
      >
        <Undo2 className="w-6 h-6" />
      </button>

      {/* 跳过 — 右上角，与撤销同高 */}
      <button
        className="absolute top-8 right-8 z-20 p-3 rounded-full bg-black/50 text-white hover:bg-black/65 backdrop-blur-sm transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
        onClick={() => void doSkip()}
        disabled={!currentItem || isFly}
        title="跳过（Space）"
      >
        <SkipForward className="w-6 h-6" />
      </button>

      {/* 分类胶囊 — 固定面板底部，大号，深色，多缩进 */}
      {categories.length > 0 && currentItem && (
        <div className="absolute bottom-0 left-0 right-0 z-20 px-8 pb-8 pt-4 flex flex-wrap gap-2.5">
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => void toggleCategory(cat.id)}
              disabled={isFly}
              className={clsx(
                'px-5 py-2 rounded-full text-base font-medium transition-colors backdrop-blur-md',
                itemCategoryIds.has(cat.id)
                  ? 'bg-primary text-white'
                  : 'bg-black/50 text-white/90 hover:bg-black/65 border border-white/10'
              )}
            >
              {cat.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
