import { useEffect, useRef, useState, useCallback } from 'react'
import { useInView } from 'react-intersection-observer'
import { ChevronLeft, ImageOff, VideoOff, ChevronRight, PanelRightOpen, PanelRightClose, Play, Pause, Heart, HeartOff, Hash, MoreVertical, EyeOff, FolderOpen, Folder, Presentation, ChevronUp, X, Video } from 'lucide-react'
import clsx from 'clsx'
import { clampScale, ZOOM_STEP } from '../lib/canvasMath'
import { CURSOR_HAND_OPEN, CURSOR_HAND_GRAB } from '../lib/handCursor'
import { useCameraShake } from '../hooks/useCameraShake'
import { useCameraShakeStore } from '../stores/cameraShake'
import { CameraShakeControls } from './canvas/CameraShakeControls'
import { useDetailStore, BUFFER_SIZE, type SeqEntry } from '../stores/detail'
import { useLibraryStore } from '../stores/library'
import { useUIStore } from '../stores/ui'
import { usePanelRecommendationsStore } from '../stores/panelRecommendations'
import { useCategoriesStore } from '../stores/categories'
import { useCanvasesStore } from '../stores/canvases'
import { useCurrentCanvasStore } from '../stores/currentCanvas'
import { CategorySearchPanel } from '../components/CategorySearchPanel'
import { CanvasPicker } from '../components/CanvasPicker'
import { ContextMenu, type ContextMenuItem } from '../components/ContextMenu'
import { pushCanvasToast } from '../components/Toast'
import { Tooltip } from '../components/Tooltip'
import { IPC } from '../../../main/ipc/contract'
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

  const [isFullscreen, setIsFullscreen] = useState(false)
  const [lockState, setLockState] = useState<'off' | 'on' | 'closing'>('off')
  useEffect(() => {
    const handler = (_evt: unknown, isFs: boolean): void => setIsFullscreen(isFs)
    window.electron.ipcRenderer.on(IPC.FULLSCREEN_CHANGE, handler)
    return () => { window.electron.ipcRenderer.removeAllListeners(IPC.FULLSCREEN_CHANGE) }
  }, [])

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
  const canvases = useCanvasesStore((s) => s.canvases)
  const addItemsToCanvas = useCanvasesStore((s) => s.addItems)
  const currentCanvasId = useCurrentCanvasStore((s) => s.currentCanvasId)

  const setCurrentCanvas = useCurrentCanvasStore((s) => s.setCurrent)

  const [itemLiked, setItemLiked] = useState(false)
  const [itemCategoryIds, setItemCategoryIds] = useState<Set<number>>(new Set())
  const [searchOpen, setSearchOpen] = useState(false)
  const [canvasPicker, setCanvasPicker] = useState<{ x: number; y: number; placement: 'top' | 'bottom' } | null>(null)
  const capsuleRef = useRef<HTMLDivElement | null>(null)
  const pickerTriggerRef = useRef<HTMLButtonElement | null>(null)

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
    setCanvasPicker(null)
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

  const handleAddToCanvas = useCallback(
    async (e: React.MouseEvent) => {
      if (!currentItem) return
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
          await addItemsToCanvas(id, [currentItem.id])
          pushCanvasToast(id, finalName, 1)
        } catch (err) {
          console.error('Failed to auto-create canvas:', err)
        }
        return
      }
      const canvas = canvases.find((c) => c.id === currentCanvasId)
      if (!canvas) return
      await addItemsToCanvas(currentCanvasId, [currentItem.id])
      pushCanvasToast(currentCanvasId, canvas.name, 1)
    },
    [currentItem, currentCanvasId, canvases, addItemsToCanvas, setCurrentCanvas]
  )

  const handleOpenCanvasPicker = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (canvasPicker) { setCanvasPicker(null); return }
    const r = capsuleRef.current?.getBoundingClientRect()
    if (!r) return
    const placement = r.top > window.innerHeight / 2 ? 'top' : 'bottom'
    setCanvasPicker({ x: r.right, y: placement === 'top' ? r.top : r.bottom, placement })
  }, [canvasPicker])

  const handleCanvasPickerSelect = useCallback(
    async (canvasId: number) => {
      if (!currentItem) return
      setCanvasPicker(null)
      const canvas = canvases.find((c) => c.id === canvasId)
      if (!canvas) return
      await addItemsToCanvas(canvasId, [currentItem.id])
      pushCanvasToast(canvasId, canvas.name, 1)
    },
    [currentItem, canvases, addItemsToCanvas]
  )

  const handleCanvasPickerCreate = useCallback(
    async (name: string) => {
      if (!currentItem) return
      setCanvasPicker(null)
      try {
        const id = await window.api.createCanvas(name)
        await useCanvasesStore.getState().load()
        setCurrentCanvas(id)
        await addItemsToCanvas(id, [currentItem.id])
        pushCanvasToast(id, name, 1)
      } catch (err) {
        console.error('createCanvas failed:', err)
      }
    },
    [currentItem, addItemsToCanvas, setCurrentCanvas]
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

  // 详情页打开时 WCO 全透明（沉浸），关闭时恢复 header 色
  useEffect(() => {
    if (isOpen) {
      void window.api.setTitleBarOverlay({
        color: '#00000000',
        symbolColor: isLight ? '#444444' : '#cccccc'
      })
    } else {
      void window.api.setTitleBarOverlay({ theme: isLight ? 'light' : 'dark' })
    }
  }, [isOpen, isLight])

  // 打开时锁定 body 滚动，防止滚轮穿透到底层瀑布流
  useEffect(() => {
    if (isOpen) {
      const prev = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = prev }
    }
    return undefined
  }, [isOpen])

  // 滚轮翻图：时间冷却 + 单步。
  // 无极/高分辨率滚轮单个 wheel 事件的 deltaY 可达数百乃至上千；旧的「deltaY 累积过阈值」
  // 模型会在一个事件里 while 循环翻多张，暴力滚动 + 惯性动量事件叠加时造成高亮乱跳、
  // 反向来回弹、最终卡死。改为：每次翻图后进入冷却窗，窗内所有 wheel 事件（含反向时仍在
  // 派发的惯性动量事件）一律忽略，单个事件最多翻 1 张 —— 把任意密度的滚轮输入规整成匀速翻页。
  // 不区分方向地统一冷却：正常主动反向时上一次翻图早已超过冷却窗，反向几乎零延迟；
  // 只有「连续快速翻图途中突然反向」才有 ≤80ms 延迟，而这正是需要被稳住的暴力场景。
  const lastFlipRef = useRef(0)
  const WHEEL_COOLDOWN = 80 // ms
  const WHEEL_DEADZONE = 2 // 忽略亚像素/零位噪声（横向滚动会派发 deltaY≈0 的事件）
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.stopPropagation()
    if (lockState !== 'off') return
    if (Math.abs(e.deltaY) < WHEEL_DEADZONE) return
    const now = e.timeStamp
    if (now - lastFlipRef.current < WHEEL_COOLDOWN) return
    lastFlipRef.current = now
    if (e.deltaY > 0) next()
    else prev()
  }, [next, prev, lockState])

  // 键盘：Esc / ←→ / 空格 / Tab。
  // 用左右而非上下，与底部缩略图导航的左右排布心智对齐（→ 下一张，← 上一张）
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        // 锁定态：Esc 退出锁定，不关闭详情页
        if (lockState !== 'off') {
          setLockState('closing')
          setTimeout(() => setLockState('off'), 220)
          return
        }
        if (searchOpen) { setSearchOpen(false); return }
        close()
        return
      }
      // 锁定态：吞掉所有其余按键，由 LockViewport 内部处理空格/F
      if (lockState !== 'off') return
      if (searchOpen) return
      if (e.key === 'Tab') { e.preventDefault(); togglePanel(); return }
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); next() }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); prev() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, lockState, searchOpen, close, next, prev, togglePanel])

  if (!isOpen && !visible) return null
  if (!currentItem) return null

  return (
    <div
      className={clsx(
        'fixed inset-0 z-50 flex flex-row',
        isLight ? 'bg-stone-300' : 'bg-black',
        'transition-opacity duration-300',
        visible ? 'opacity-100' : 'opacity-0'
      )}
      onWheel={handleWheel}
    >
      <div className="relative flex-1 min-w-0 flex flex-col items-center justify-center">
        {/* 顶部渐变遮罩：从窗口顶端向下淡出，pointer-events-none 不干扰拖拽 */}
        {lockState === 'off' && (
          <div
            className="absolute left-0 right-0 top-0 h-40 z-10 pointer-events-none"
            style={{
              background: isLight
                ? 'linear-gradient(to bottom, rgba(214,211,209,0.97) 0%, rgba(214,211,209,0.7) 40%, rgba(214,211,209,0.2) 75%, transparent 100%)'
                : 'linear-gradient(to bottom, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.6) 40%, rgba(0,0,0,0.2) 75%, transparent 100%)'
            }}
          />
        )}

        {/* 顶栏容器 */}
        {lockState === 'off' && (
          <div
            className="absolute left-0 right-0 top-0 z-20 flex items-center gap-3 px-4 py-3"
            style={{ paddingRight: 156, WebkitAppRegion: 'drag' } as React.CSSProperties}
          >
            <button
              onClick={close}
              aria-label="后退"
              className={clsx(
                'flex-shrink-0 grid place-items-center p-3 rounded-full transition-colors focus:outline-none focus-visible:outline-none backdrop-blur-sm',
                isLight ? 'bg-white/70 text-gray-900 hover:bg-white/85' : 'bg-black/45 text-white hover:bg-black/65'
              )}
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
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
          </div>
        )}

        {/* 面板开关按钮 */}
        {lockState === 'off' && (
          <Tooltip text={panelOpen ? '收起推荐（Tab）' : '推荐（Tab）'} side="bottom">
            <button
              onClick={togglePanel}
              aria-label={panelOpen ? '收起推荐面板' : '展开推荐面板'}
              className={clsx(
                'fixed z-[60] grid place-items-center p-2 rounded-lg transition-colors focus:outline-none focus-visible:outline-none',
                isLight ? 'text-gray-700 hover:bg-black/10' : 'text-white/80 hover:bg-white/15'
              )}
              style={{ top: 16, right: isFullscreen ? 8 : 148, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
              {panelOpen ? <PanelRightClose className="w-5 h-5" /> : <PanelRightOpen className="w-5 h-5" />}
            </button>
          </Tooltip>
        )}

        {/* 内容区（瞬切，无位移动效）。父容器宽度随面板挤压收缩，img 自动 fit */}
        <div
          className="w-full h-full flex items-center justify-center"
          onDoubleClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setLockState('on')
          }}
        >
          {currentItem.type === 'video' ? (
            <VideoPlayer item={currentItem} onEnterLock={() => setLockState('on')} />
          ) : (
            <ImageViewer item={currentItem} />
          )}
        </div>

        {/* 底部缩略图条 */}
        {lockState === 'off' && (
          <ThumbStrip sequence={sequence} cursor={cursor} jumpTo={jumpTo} />
        )}

        {/* 底部左侧操作区：喜欢(f) + 分隔线 + 分类入口(h)，不与缩略图条争位 */}
        {lockState === 'off' && (
          <div className="absolute bottom-5 left-4 z-20 flex items-center gap-2">
            {/* f：喜欢 */}
            <button
              onClick={() => { void handleLikeToggle() }}
              aria-label={itemLiked ? '取消喜欢' : '喜欢'}
              className={clsx(
                'grid place-items-center p-3 rounded-full transition-colors focus:outline-none backdrop-blur-sm',
                itemLiked
                  ? 'bg-pink-500/90 text-white hover:bg-pink-400/90'
                  : isLight
                    ? 'bg-white/70 text-gray-900/60 hover:bg-white/85 hover:text-gray-900'
                    : 'bg-black/45 text-white/70 hover:bg-black/65 hover:text-white'
              )}
            >
              <Heart className={clsx('w-5 h-5', itemLiked && 'fill-current')} />
            </button>

            <div className={isLight ? 'w-px h-6 bg-foreground/15' : 'w-px h-6 bg-white/25'} />

            {/* h：# 按钮，relative 用于面板锚定 */}
            <div className="relative">
              <Tooltip text="管理分类" side="top">
                <button
                  onClick={() => setSearchOpen((v) => !v)}
                  aria-label="管理分类"
                  className={clsx(
                    'grid place-items-center p-3 rounded-full transition-colors focus:outline-none backdrop-blur-sm',
                    searchOpen
                      ? 'bg-primary text-white'
                      : isLight
                        ? 'bg-white/70 text-gray-900/60 hover:bg-white/85 hover:text-gray-900'
                        : 'bg-black/45 text-white/70 hover:bg-black/65 hover:text-white'
                  )}
                >
                  <Hash className="w-5 h-5" />
                </button>
              </Tooltip>

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
        )}

        {/* 加入画布胶囊 */}
        {lockState === 'off' && (
          <div
            ref={capsuleRef}
            className={clsx(
              'absolute bottom-5 right-4 z-20 flex items-center rounded-full backdrop-blur-sm overflow-hidden',
              isLight ? 'bg-white/70 text-gray-900/60' : 'bg-black/45 text-white/70'
            )}
          >
            <Tooltip text={currentCanvasId ? '加入当前画布' : '新建画布并加入'}>
              <button
                onClick={(e) => { void handleAddToCanvas(e) }}
                className={clsx(
                  'px-3.5 py-3 transition-colors focus:outline-none',
                  isLight ? 'hover:bg-white/85 hover:text-gray-900' : 'hover:bg-black/65 hover:text-white'
                )}
              >
                <Presentation className="w-5 h-5" />
              </button>
            </Tooltip>
            <div className={clsx('w-px h-4 flex-shrink-0', isLight ? 'bg-foreground/15' : 'bg-white/25')} />
            <Tooltip text="选择画布">
              <button
                ref={pickerTriggerRef}
                onClick={handleOpenCanvasPicker}
                className={clsx(
                  'px-2.5 py-3 transition-colors focus:outline-none',
                  canvasPicker
                    ? 'bg-primary/80 text-white'
                    : isLight ? 'hover:bg-white/85 hover:text-gray-900' : 'hover:bg-black/65 hover:text-white'
                )}
              >
                <ChevronUp className="w-4 h-4" />
              </button>
            </Tooltip>
          </div>
        )}

        {/* 画布 picker */}
        {lockState === 'off' && canvasPicker && (
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

        {/* 面板打开时的透明点击捕获层（点面板外区域关闭，z-[19] 低于操作区 z-20） */}
        {lockState === 'off' && searchOpen && (
          <div
            className="absolute inset-0 z-[19]"
            onClick={() => setSearchOpen(false)}
          />
        )}

        {/* 锁定模式 overlay */}
        {lockState !== 'off' && (
          <LockViewport
            item={currentItem}
            isLight={isLight}
            closing={lockState === 'closing'}
            onRequestClose={() => {
              setLockState('closing')
              setTimeout(() => setLockState('off'), 220)
            }}
          />
        )}
      </div>

      {/* 右侧推荐面板（d）— 挤压布局：宽度受 open 切换 0/PANEL_WIDTH，width 动画收展 */}
      <RecommendationsPanel open={panelOpen && lockState === 'off'} />

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
function VideoPlayer({ item, onEnterLock }: { item: MediaItem; onEnterLock: () => void }): React.JSX.Element {
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
      loop
      playsInline
      preload="auto"
      className="w-full h-full object-contain"
      onCanPlay={handleCanPlay}
      onError={handleError}
      onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); onEnterLock() }}
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
        'relative flex-shrink-0 overflow-hidden',
        isLight
          ? 'bg-stone-300 border-l border-stone-400'
          : 'bg-black/40 backdrop-blur-md border-l border-white/10',
        'transition-[width] duration-[250ms] ease-out'
      )}
      style={{ width: open ? PANEL_WIDTH : 0 }}
      aria-hidden={!open}
      onWheel={(e) => e.stopPropagation()}
    >
      <div className="h-full flex flex-col" style={{ width: PANEL_WIDTH }}>
        {/* WCO 占位：推荐内容不进入系统按钮覆盖区域 */}
        <div className="flex-shrink-0" style={{ height: 64 }} />
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

// ─── 锁定模式：单图 pan/zoom 沉浸查看 ───────────────────────────────────────

interface LockViewportProps {
  item: MediaItem
  isLight: boolean
  closing: boolean
  onRequestClose: () => void
}

function LockViewport({ item, isLight, closing, onRequestClose }: LockViewportProps): React.JSX.Element {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const shakeLayerRef = useRef<HTMLDivElement | null>(null)
  const tRef = useRef({ tx: 0, ty: 0, s: 1 })
  const [t, setT] = useState<{ tx: number; ty: number; s: number }>({ tx: 0, ty: 0, s: 1 })

  // 摄影机手摇：锁定模式是「视口」上下文，复用同一 hook + 同一份参数（只消费，不开面板）
  useCameraShake(shakeLayerRef, { active: true })

  // 同步更新 ref + state，避免 render 阶段写 ref
  const updateT = useCallback((newT: { tx: number; ty: number; s: number }) => {
    tRef.current = newT
    setT(newT)
  }, [])

  // 进出脉冲动效
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  // pan cursor 注入
  const panCursorStyleRef = useRef<HTMLStyleElement | null>(null)
  const setPanCursor = useCallback((cursor: string | null) => {
    if (cursor === null) {
      if (panCursorStyleRef.current) {
        document.head.removeChild(panCursorStyleRef.current)
        panCursorStyleRef.current = null
      }
      return
    }
    if (!panCursorStyleRef.current) {
      panCursorStyleRef.current = document.createElement('style')
      document.head.appendChild(panCursorStyleRef.current)
    }
    const text = `* { cursor: ${cursor} !important; }`
    if (panCursorStyleRef.current.textContent !== text) {
      panCursorStyleRef.current.textContent = text
    }
  }, [])

  // 卸载时清除 cursor
  useEffect(() => {
    return () => {
      if (panCursorStyleRef.current) {
        document.head.removeChild(panCursorStyleRef.current)
        panCursorStyleRef.current = null
      }
    }
  }, [])

  // 空格键状态
  const spaceHeldRef = useRef(false)
  const isPanningRef = useRef(false)

  // F 键复位 + 空格 pan
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.code === 'Space') {
        e.preventDefault()
        spaceHeldRef.current = true
        if (!isPanningRef.current) setPanCursor(CURSOR_HAND_OPEN)
      } else if (e.key === 'f' || e.key === 'F') {
        updateT({ tx: 0, ty: 0, s: 1 })
      }
    }
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.code === 'Space') {
        spaceHeldRef.current = false
        if (!isPanningRef.current) setPanCursor(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [setPanCursor, updateT])

  // 滚轮缩放（非 passive，必须原生绑定）
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const { tx, ty, s } = tRef.current
      const rect = el.getBoundingClientRect()
      const cx = e.clientX - rect.left
      const cy = e.clientY - rect.top
      const delta = e.deltaY > 0 ? -1 : 1
      const currentLevel = Math.round(Math.log(s) / Math.log(ZOOM_STEP))
      const newS = clampScale(Math.pow(ZOOM_STEP, currentLevel + delta))
      const ratio = newS / s
      updateT({ tx: cx - (cx - tx) * ratio, ty: cy - (cy - ty) * ratio, s: newS })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [updateT])

  // Pan（中键 or 空格+左键）
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    let startX = 0, startY = 0, startTx = 0, startTy = 0

    const onPointerDown = (e: PointerEvent): void => {
      const isMid = e.button === 1
      const isSpaceLeft = e.button === 0 && spaceHeldRef.current
      if (!isMid && !isSpaceLeft) return
      e.preventDefault()
      startX = e.clientX
      startY = e.clientY
      startTx = tRef.current.tx
      startTy = tRef.current.ty
      isPanningRef.current = true
      el.setPointerCapture(e.pointerId)
      setPanCursor(CURSOR_HAND_GRAB)
    }
    const onPointerMove = (e: PointerEvent): void => {
      if (!isPanningRef.current) return
      updateT({ ...tRef.current, tx: startTx + e.clientX - startX, ty: startTy + e.clientY - startY })
    }
    const onPointerUp = (): void => {
      if (!isPanningRef.current) return
      isPanningRef.current = false
      setPanCursor(spaceHeldRef.current ? CURSOR_HAND_OPEN : null)
    }
    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', onPointerUp)
    el.addEventListener('pointercancel', onPointerUp)
    return () => {
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', onPointerUp)
      el.removeEventListener('pointercancel', onPointerUp)
    }
  }, [setPanCursor, updateT])

  // 视频 ref
  const videoRef = useRef<HTMLVideoElement | null>(null)

  // 进出脉冲 inline style
  const pulseStyle: React.CSSProperties = {
    scale: mounted && !closing ? '1' : '1.05',
    opacity: mounted && !closing ? 1 : 0,
    transition: 'scale 0.28s ease-out, opacity 0.28s ease-out',
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  }

  return (
    <div
      ref={viewportRef}
      className={clsx('absolute inset-0 z-30 overflow-hidden', isLight ? 'bg-stone-300' : 'bg-black')}
      onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); onRequestClose() }}
    >
      {/* 进出脉冲 wrapper */}
      <div style={pulseStyle}>
        {/* 摄影机手摇层：transform 完全归 useCameraShake 所有（停用时为空） */}
        <div
          ref={shakeLayerRef}
          className="camera-shake-layer w-full h-full"
          style={{ transformOrigin: 'center', willChange: 'transform' }}
        >
          {/* pan/zoom 变换层 */}
          <div
            className="w-full h-full"
            style={{
              transform: `translate(${t.tx}px, ${t.ty}px) scale(${t.s})`,
              transformOrigin: '0 0',
            }}
          >
            {item.type === 'video' ? (
              <video
                ref={videoRef}
                src={`serendip://video/${item.id}`}
                autoPlay
                muted
                loop
                playsInline
                className="w-full h-full object-contain"
                onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation() }}
              />
            ) : (
              <LockImage item={item} />
            )}
          </div>
        </div>
      </div>

      {/* 左上角退出按钮（复刻原后退样式，图标换 X） */}
      <button
        onClick={onRequestClose}
        aria-label="退出锁定"
        className={clsx(
          'absolute left-4 top-3 z-40 grid place-items-center p-3 rounded-full transition-colors focus:outline-none focus-visible:outline-none backdrop-blur-sm',
          isLight ? 'bg-white/70 text-gray-900 hover:bg-white/85' : 'bg-black/45 text-white hover:bg-black/65'
        )}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <X className="w-6 h-6" />
      </button>

      {/* 摄影机手摇浮条（鼠标近底部时显现；视频时上移让开进度条） */}
      <LockShakeBar liftForScrubber={item.type === 'video'} />

      {/* 视频进度条 */}
      {item.type === 'video' && <VideoScrubber videoRef={videoRef} />}
    </div>
  )
}

function LockImage({ item }: { item: MediaItem }): React.JSX.Element {
  const [fullLoaded, setFullLoaded] = useState(false)
  const [error, setError] = useState(false)
  useEffect(() => { setFullLoaded(false); setError(false) }, [item.id])
  if (error) return (
    <div className="flex flex-col items-center gap-3 text-muted-foreground">
      <ImageOff className="w-12 h-12" />
      <p className="text-sm">无法加载图片</p>
    </div>
  )
  return (
    <div className="relative w-full h-full flex items-center justify-center">
      {!fullLoaded && (
        <img src={`serendip://thumb/${item.id}`} alt="" className="absolute max-w-full max-h-full object-contain select-none pointer-events-none" draggable={false} />
      )}
      <img
        src={`serendip://image/${item.id}`}
        alt=""
        className="absolute max-w-full max-h-full object-contain select-none"
        draggable={false}
        style={{ opacity: fullLoaded ? 1 : 0 }}
        onLoad={() => setFullLoaded(true)}
        onError={() => setError(true)}
      />
    </div>
  )
}

interface VideoScrubberProps {
  videoRef: React.RefObject<HTMLVideoElement | null>
}

function VideoScrubber({ videoRef }: VideoScrubberProps): React.JSX.Element {
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [barVisible, setBarVisible] = useState(false)
  const [seeking, setSeeking] = useState(false)
  const trackRef = useRef<HTMLDivElement | null>(null)

  // 驱动进度
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const onTimeUpdate = (): void => setCurrentTime(v.currentTime)
    const onLoaded = (): void => setDuration(v.duration || 0)
    const onPlay = (): void => setPlaying(true)
    const onPause = (): void => setPlaying(false)
    v.addEventListener('timeupdate', onTimeUpdate)
    v.addEventListener('loadedmetadata', onLoaded)
    v.addEventListener('play', onPlay)
    v.addEventListener('pause', onPause)
    return () => {
      v.removeEventListener('timeupdate', onTimeUpdate)
      v.removeEventListener('loadedmetadata', onLoaded)
      v.removeEventListener('play', onPlay)
      v.removeEventListener('pause', onPause)
    }
  }, [videoRef])

  // 鼠标距底部阈值显隐
  useEffect(() => {
    const onMove = (e: PointerEvent): void => {
      if (seeking) return
      setBarVisible(window.innerHeight - e.clientY < 140)
    }
    window.addEventListener('pointermove', onMove)
    return () => window.removeEventListener('pointermove', onMove)
  }, [seeking])

  const seekTo = useCallback((e: React.MouseEvent | MouseEvent): void => {
    const track = trackRef.current
    const v = videoRef.current
    if (!track || !v || !duration) return
    const rect = track.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    v.currentTime = ratio * duration
    setCurrentTime(ratio * duration)
  }, [videoRef, duration])

  const handleTrackDown = useCallback((e: React.PointerEvent): void => {
    e.preventDefault()
    setSeeking(true)
    setBarVisible(true)
    seekTo(e.nativeEvent)
    const onMove = (ev: MouseEvent): void => seekTo(ev)
    const onUp = (): void => {
      setSeeking(false)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [seekTo])

  const togglePlay = useCallback((): void => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) v.play().catch(() => { /* ignore */ })
    else v.pause()
  }, [videoRef])

  const visible = barVisible || seeking
  const progress = duration > 0 ? currentTime / duration : 0

  return (
    <div
      onDoubleClick={(e) => {
        // 锁定模式下双击进度条不应穿透触发退出
        e.preventDefault()
        e.stopPropagation()
      }}
      className={clsx(
        'absolute bottom-0 left-0 right-0 z-40 px-4 pb-4 pt-3 flex items-center gap-3',
        'bg-glass backdrop-blur-xl transition-[opacity,pointer-events] duration-200',
        visible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
      )}
    >
      <button onClick={togglePlay} className="flex-shrink-0 text-foreground focus:outline-none">
        {playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
      </button>
      <span className="text-foreground text-xs tabular-nums flex-shrink-0 select-none">
        {formatDuration(currentTime * 1000)} / {formatDuration(duration * 1000)}
      </span>
      {/* 进度轨道 */}
      <div
        ref={trackRef}
        className="flex-1 h-1.5 rounded-full bg-foreground/20 relative cursor-pointer"
        onPointerDown={handleTrackDown}
      >
        <div
          className="absolute left-0 top-0 h-full rounded-full bg-primary"
          style={{ width: `${progress * 100}%` }}
        />
        {/* 拖拽点 */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-primary shadow-md"
          style={{ left: `calc(${progress * 100}% - 7px)` }}
        />
      </div>
    </div>
  )
}

/**
 * 锁定模式底部的摄影机手摇浮条 —— 复用画布同一套 CameraShakeControls。
 * - 鼠标进入窗口底部阈值（与进度条同款 140px）才显现
 * - 弹层（预设列表/参数面板）打开时强制保持可见
 * - 视频时上移让开 VideoScrubber，避免 overlap
 * - 浮条内双击不穿透（否则快速 toggle 会触发锁定模式的双击退出）
 */
function LockShakeBar({ liftForScrubber }: { liftForScrubber: boolean }): React.JSX.Element | null {
  const enabled = useCameraShakeStore((s) => s.enabled)
  const toggleEnabled = useCameraShakeStore((s) => s.toggleEnabled)
  const [nearBottom, setNearBottom] = useState(false)
  const [popoverOpen, setPopoverOpen] = useState(false)

  useEffect(() => {
    const onMove = (e: PointerEvent): void => {
      setNearBottom(window.innerHeight - e.clientY < 140)
    }
    window.addEventListener('pointermove', onMove)
    return () => window.removeEventListener('pointermove', onMove)
  }, [])

  const visible = nearBottom || popoverOpen

  return (
    <div
      onDoubleClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      className={clsx(
        'absolute left-1/2 -translate-x-1/2 z-50 flex items-center gap-0.5 rounded-xl border border-border bg-glass backdrop-blur-xl px-2.5 py-1.5 shadow-lg select-none',
        'transition-[opacity,pointer-events] duration-200',
        // 视频时抬高到进度条上方（进度条约 56px 高），图片时贴近底部
        liftForScrubber ? 'bottom-[84px]' : 'bottom-4',
        visible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
      )}
    >
      {/* 摄影机总开关（高亮为主题色） */}
      <Tooltip text={enabled ? '关闭摄影机手摇' : '开启摄影机手摇'} side="top">
        <button
          onClick={toggleEnabled}
          className={clsx(
            'p-1.5 rounded-lg transition-colors',
            enabled
              ? 'text-primary hover:bg-sidebar-hover'
              : 'text-muted-foreground hover:bg-sidebar-hover hover:text-foreground'
          )}
        >
          <Video className="w-3.5 h-3.5" />
        </button>
      </Tooltip>
      <CameraShakeControls disabled={!enabled} onPopoverChange={setPopoverOpen} />
    </div>
  )
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
      {/* rootPath 以上：灰化、更半透、不可点 */}
      {rootParts.map((seg, i) => (
        <span key={`above-${i}`} className="flex items-center opacity-35">
          <span className="font-normal text-foreground px-1">{seg}</span>
          <ChevronRight className="w-4 h-4 text-foreground flex-shrink-0" />
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
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
              {rootParts[rootParts.length - 1] ?? rootSegPath}
            </button>
            {relParts.length > 0 && (
              <ChevronRight className="w-4 h-4 text-foreground/20 flex-shrink-0" />
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
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
              {seg}
            </button>
            <ChevronRight className="w-4 h-4 text-foreground/20 flex-shrink-0" />
          </span>
        )
      })}

      {/* 文件名（leaf，仅展示，不可点、不加粗、半透） */}
      {(() => {
        const filename = item.path.replace(/\\/g, '/').split('/').pop() ?? ''
        return (
          <span className="font-normal text-foreground opacity-35 px-1">{filename}</span>
        )
      })()}
    </div>
  )
}
