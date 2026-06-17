import { useEffect, useRef, useCallback } from 'react'
import { useCurrentCanvasStore } from '../../stores/currentCanvas'
import { useCanvasesStore } from '../../stores/canvases'
import { useCanvasItemsStore } from '../../stores/canvasItems'
import { useCanvasViewportStore, flushViewportNow } from '../../stores/canvasViewport'
import { fitViewport, clampScale, DEFAULT_VIEWPORT, ZOOM_STEP } from '../../lib/canvasMath'
import { CanvasItemNode } from './CanvasItemNode'
import { CanvasToolbar } from './CanvasToolbar'

interface Props {
  canvasId: number
}

export function CanvasView({ canvasId }: Props): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const spaceHeldRef = useRef(false)
  const isPanningRef = useRef(false)
  const panStartRef = useRef<{
    clientX: number
    clientY: number
    vpX: number
    vpY: number
    vpScale: number
  } | null>(null)
  const didAutoFitRef = useRef(false)

  const setCurrent = useCurrentCanvasStore((s) => s.setCurrent)
  const items = useCanvasItemsStore((s) => s.items)
  const loading = useCanvasItemsStore((s) => s.loading)
  const load = useCanvasItemsStore((s) => s.load)
  const unload = useCanvasItemsStore((s) => s.unload)
  const canvas = useCanvasesStore((s) => s.canvases.find((c) => c.id === canvasId))
  const viewport = useCanvasViewportStore((s) => s.byId[canvasId] ?? DEFAULT_VIEWPORT)
  const initViewport = useCanvasViewportStore((s) => s.initViewport)
  const setViewport = useCanvasViewportStore((s) => s.setViewport)

  // 设置当前画布 + 从 DB 初始化视口（仅首次）
  useEffect(() => {
    setCurrent(canvasId)
    if (canvas) {
      initViewport(canvasId, {
        x: canvas.viewportX,
        y: canvas.viewportY,
        scale: canvas.viewportScale
      })
    }
  }, [canvasId, canvas, setCurrent, initViewport])

  // 加载 items
  useEffect(() => {
    void load(canvasId)
  }, [canvasId, load])

  // unmount：flush 视口 + 清空 items
  useEffect(() => {
    return () => {
      unload()
      const vp = useCanvasViewportStore.getState().byId[canvasId]
      if (vp) flushViewportNow(canvasId, vp)
    }
  }, [canvasId, unload])

  // 首次有 items 且视口为默认值时自动 fit
  useEffect(() => {
    if (items.length === 0 || didAutoFitRef.current) return
    const vp = useCanvasViewportStore.getState().byId[canvasId]
    if (vp && !(vp.x === 0 && vp.y === 0 && vp.scale === 1)) return // 已有自定义视口
    const container = containerRef.current
    if (!container) return
    const { width, height } = container.getBoundingClientRect()
    if (width === 0 || height === 0) return
    setViewport(canvasId, fitViewport(items, width, height, 0.1))
    didAutoFitRef.current = true
  }, [canvasId, items, setViewport])

  // F 聚焦
  const handleFit = useCallback(() => {
    const container = containerRef.current
    if (!container || items.length === 0) return
    const { width, height } = container.getBoundingClientRect()
    setViewport(canvasId, fitViewport(items, width, height, 0.1))
  }, [canvasId, items, setViewport])

  // ── wheel → 离散档位 zoom（以光标为锚点）；pan 只走中键/Space+左键 ──
  // 每档 scale *= ZOOM_STEP，scale=1 为 0 档，正数放大负数缩小
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const rect = container.getBoundingClientRect()
      const cx = e.clientX - rect.left
      const cy = e.clientY - rect.top
      const vp = useCanvasViewportStore.getState().byId[canvasId] ?? DEFAULT_VIEWPORT
      const delta = e.deltaY > 0 ? -1 : 1
      const currentLevel = Math.round(Math.log(vp.scale) / Math.log(ZOOM_STEP))
      const newScale = clampScale(Math.pow(ZOOM_STEP, currentLevel + delta))
      const worldX = cx / vp.scale + vp.x
      const worldY = cy / vp.scale + vp.y
      setViewport(canvasId, {
        x: worldX - cx / newScale,
        y: worldY - cy / newScale,
        scale: newScale
      })
    }

    container.addEventListener('wheel', onWheel, { passive: false })
    return () => container.removeEventListener('wheel', onWheel)
  }, [canvasId, setViewport])

  // ── 中键 / Space+左键 Pan ─────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const onPointerDown = (e: PointerEvent): void => {
      const isMid = e.button === 1
      const isSpaceLeft = spaceHeldRef.current && e.button === 0
      if (!isMid && !isSpaceLeft) return

      e.preventDefault()
      const vp = useCanvasViewportStore.getState().byId[canvasId] ?? DEFAULT_VIEWPORT
      panStartRef.current = {
        clientX: e.clientX,
        clientY: e.clientY,
        vpX: vp.x,
        vpY: vp.y,
        vpScale: vp.scale
      }
      isPanningRef.current = true
      container.setPointerCapture(e.pointerId)
      container.style.cursor = 'grabbing'
    }

    const onPointerMove = (e: PointerEvent): void => {
      if (!isPanningRef.current || !panStartRef.current) return
      const dx = e.clientX - panStartRef.current.clientX
      const dy = e.clientY - panStartRef.current.clientY
      const currentScale = useCanvasViewportStore.getState().byId[canvasId]?.scale ?? panStartRef.current.vpScale
      setViewport(canvasId, {
        x: panStartRef.current.vpX - dx / panStartRef.current.vpScale,
        y: panStartRef.current.vpY - dy / panStartRef.current.vpScale,
        scale: currentScale
      })
    }

    const onPointerUp = (): void => {
      if (!isPanningRef.current) return
      isPanningRef.current = false
      panStartRef.current = null
      container.style.cursor = spaceHeldRef.current ? 'grab' : ''
    }

    container.addEventListener('pointerdown', onPointerDown)
    container.addEventListener('pointermove', onPointerMove)
    container.addEventListener('pointerup', onPointerUp)
    container.addEventListener('pointercancel', onPointerUp)
    return () => {
      container.removeEventListener('pointerdown', onPointerDown)
      container.removeEventListener('pointermove', onPointerMove)
      container.removeEventListener('pointerup', onPointerUp)
      container.removeEventListener('pointercancel', onPointerUp)
    }
  }, [canvasId, setViewport])

  // ── Space 保持手形 + F 聚焦 ──────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return

      if (e.code === 'Space') {
        e.preventDefault()
        spaceHeldRef.current = true
        if (containerRef.current && !isPanningRef.current) {
          containerRef.current.style.cursor = 'grab'
        }
      } else if (e.key === 'f' || e.key === 'F') {
        handleFit()
      }
    }

    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.code === 'Space') {
        spaceHeldRef.current = false
        if (!isPanningRef.current && containerRef.current) {
          containerRef.current.style.cursor = ''
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [handleFit])

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden bg-canvas select-none"
      style={{ touchAction: 'none' }}
    >
      {/* 画布元素 */}
      {items.map((item, i) => (
        <CanvasItemNode key={item.id} item={item} viewport={viewport} index={i} />
      ))}

      {/* 空态 */}
      {!loading && items.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <p className="text-sm text-muted-foreground">把图片或视频拖到侧栏画布开始</p>
        </div>
      )}

      {/* 底部工具栏 */}
      <CanvasToolbar viewport={viewport} onFit={handleFit} />
    </div>
  )
}
