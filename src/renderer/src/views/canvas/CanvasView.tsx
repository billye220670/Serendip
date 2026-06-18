import { useEffect, useLayoutEffect, useRef, useCallback, useState } from 'react'
import { flushSync } from 'react-dom'
import Moveable from 'react-moveable'
import Selecto from 'react-selecto'
import { CornerRotateOverlay } from './CornerRotateOverlay'
import { useCurrentCanvasStore } from '../../stores/currentCanvas'
import { useCanvasesStore } from '../../stores/canvases'
import { useCanvasItemsStore } from '../../stores/canvasItems'
import { useCanvasViewportStore, flushViewportNow } from '../../stores/canvasViewport'
import { useCanvasSelectionStore } from '../../stores/canvasSelection'
import { fitViewport, clampScale, DEFAULT_VIEWPORT, ZOOM_STEP } from '../../lib/canvasMath'
import { CanvasItemNode } from './CanvasItemNode'
import { CanvasToolbar } from './CanvasToolbar'

// 自定义 hand cursor — 实心：深色底层描边（3.5px）+ 白色前景描边（2px）
// viewBox 0 0 24 24 → 32×32 cursor；hotspot 在手掌中心
const HAND_OPEN_PATHS = [
  'M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2',
  'M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2',
  'M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8',
  'M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15',
]
const HAND_GRAB_PATHS = [
  'M18 11.5V9a2 2 0 0 0-2-2a2 2 0 0 0-2 2v1.4',
  'M14 10V8a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2',
  'M10 9.9V9a2 2 0 0 0-2-2a2 2 0 0 0-2 2v5',
  'M6 14a2 2 0 0 0-2-2a2 2 0 0 0-2 2',
  'M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-4a8 8 0 0 1-8-8 2 2 0 1 1 4 0',
]

function makeHandCursor(paths: string[], hotX: number, hotY: number): string {
  const attrs = 'fill="none" stroke-linecap="round" stroke-linejoin="round"'
  const dark  = paths.map(d => `<path d="${d}" ${attrs} stroke="rgba(0,0,0,0.65)" stroke-width="3.5"/>`).join('')
  const white = paths.map(d => `<path d="${d}" ${attrs} stroke="white" stroke-width="2"/>`).join('')
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24">` +
    dark + white +
    `</svg>`
  return `url("data:image/svg+xml;base64,${btoa(svg)}") ${hotX} ${hotY}, pointer`
}

// hotspot 单位是 cursor 图像像素（32px 空间），手掌中心约在 viewBox(11,10) → pixel(15,13)
const CURSOR_HAND_OPEN = makeHandCursor(HAND_OPEN_PATHS, 15, 13)
const CURSOR_HAND_GRAB = makeHandCursor(HAND_GRAB_PATHS, 15, 13)

// 自定义 resize cursor — 原始 SVG 为水平双箭头（←→），对应 0° / ew-resize
const RESIZE_ICON_PATH =
  'M260.047238 468.21181h498.492952V292.571429l260.096 216.697904-260.096 216.746667v-160.280381H260.047238v160.280381L0 509.269333 260.047238 292.571429v175.640381z'

function makeResizeCursor(deg: number): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 1024 1024">` +
    `<defs><filter id="s" x="-25%" y="-25%" width="150%" height="150%">` +
    `<feDropShadow dx="0" dy="30" stdDeviation="35" flood-opacity="0.45"/>` +
    `</filter></defs>` +
    `<g transform="rotate(${deg},512,512)">` +
    `<path d="${RESIZE_ICON_PATH}" fill="white" filter="url(#s)"/>` +
    `<path d="${RESIZE_ICON_PATH}" fill="none" stroke="rgba(0,0,0,0.5)" stroke-width="30"/>` +
    `</g>` +
    `</svg>`
  return `url("data:image/svg+xml;base64,${btoa(svg)}") 16 16, pointer`
}

interface Props {
  canvasId: number
}

export function CanvasView({ canvasId }: Props): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null)
  const [isResizing, setIsResizing] = useState(false)
  const resizeCursorStyleRef = useRef<HTMLStyleElement | null>(null)

  const lockResizeCursor = useCallback((inputX: number, inputY: number) => {
    const cr = containerRef.current?.getBoundingClientRect() ?? new DOMRect()
    const vp = useCanvasViewportStore.getState().byId[canvasId] ?? DEFAULT_VIEWPORT
    const allItems = useCanvasItemsStore.getState().items
    const selSet = useCanvasSelectionStore.getState().selected
    const selItems = allItems.filter((it) => selSet.has(it.id))
    if (selItems.length === 0) return
    let cx: number, cy: number
    if (selItems.length === 1) {
      cx = (selItems[0].x - vp.x) * vp.scale + cr.left
      cy = (selItems[0].y - vp.y) * vp.scale + cr.top
    } else {
      cx = selItems.reduce((s, it) => s + (it.x - vp.x) * vp.scale + cr.left, 0) / selItems.length
      cy = selItems.reduce((s, it) => s + (it.y - vp.y) * vp.scale + cr.top, 0) / selItems.length
    }
    const deg = Math.atan2(inputY - cy, inputX - cx) * (180 / Math.PI)
    const style = document.createElement('style')
    style.textContent = `* { cursor: ${makeResizeCursor(((deg % 180) + 180) % 180)} !important; }`
    document.head.appendChild(style)
    resizeCursorStyleRef.current = style
  }, [canvasId])

  const unlockResizeCursor = useCallback(() => {
    if (resizeCursorStyleRef.current) {
      document.head.removeChild(resizeCursorStyleRef.current)
      resizeCursorStyleRef.current = null
    }
  }, [])
  const containerCallbackRef = useCallback((el: HTMLDivElement | null) => {
    containerRef.current = el
    setContainerEl(el)
  }, [])
  const moveableRef = useRef<InstanceType<typeof Moveable>>(null)

  // Moveable resize 手柄 hover cursor 替换
  // 延迟到 rAF 后用 getBoundingClientRect 取手柄实际屏幕中心，与 lockResizeCursor（拖拽时）完全相同的几何计算
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const VALID_DIRS = new Set(['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'])

    const applyToHandle = (el: HTMLElement): void => {
      if (el.getAttribute('data-rotation') === null) return
      const cls = el.className || ''
      // 覆盖可见点（moveable-control）和 hover 区（moveable-around-control），均含 moveable-direction
      if (!cls.includes('moveable-direction')) return
      const dir = el.getAttribute('data-direction') ?? ''
      if (!VALID_DIRS.has(dir)) return  // line 元素或旋转手柄，跳过

      // 延迟到下一帧：MutationObserver 在 layout 前触发，此时 getBoundingClientRect 才准确
      requestAnimationFrame(() => {
        if (!el.isConnected) return
        const hr = el.getBoundingClientRect()
        if (hr.width === 0 && hr.height === 0) return
        const hx = hr.left + hr.width / 2
        const hy = hr.top + hr.height / 2

        const cr = containerRef.current?.getBoundingClientRect()
        if (!cr) return
        const vp = useCanvasViewportStore.getState().byId[canvasId] ?? DEFAULT_VIEWPORT
        const allItems = useCanvasItemsStore.getState().items
        const selSet = useCanvasSelectionStore.getState().selected
        const selItems = allItems.filter((it) => selSet.has(it.id))
        if (selItems.length === 0) return

        // 与 lockResizeCursor 完全相同的中心计算
        const cx = selItems.reduce((s, it) => s + (it.x - vp.x) * vp.scale + cr.left, 0) / selItems.length
        const cy = selItems.reduce((s, it) => s + (it.y - vp.y) * vp.scale + cr.top, 0) / selItems.length

        const deg = Math.atan2(hy - cy, hx - cx) * (180 / Math.PI)
        el.style.cursor = makeResizeCursor(((deg % 180) + 180) % 180)
      })
    }

    const applyToSubtree = (root: Element): void => {
      if (root instanceof HTMLElement) applyToHandle(root)
      root.querySelectorAll<HTMLElement>('[data-rotation]').forEach(applyToHandle)
    }

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach((node) => {
            if (node instanceof Element) applyToSubtree(node)
          })
        } else {
          const el = mutation.target as HTMLElement
          applyToHandle(el)
        }
      }
    })

    observer.observe(container, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-rotation'],
    })

    return () => observer.disconnect()
  }, [containerEl])
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
  // 框选完成后 click 事件不应清空选区
  const selectoJustSelectedRef = useRef(false)
  // 未选中元素 pointerDown 后，等待移动阈值才真正启动拖拽
  const pendingDragCleanupRef = useRef<(() => void) | null>(null)

  const setCurrent = useCurrentCanvasStore((s) => s.setCurrent)
  const items = useCanvasItemsStore((s) => s.items)
  const loading = useCanvasItemsStore((s) => s.loading)
  const load = useCanvasItemsStore((s) => s.load)
  const unload = useCanvasItemsStore((s) => s.unload)
  const updateItems = useCanvasItemsStore((s) => s.updateItems)
  const canvas = useCanvasesStore((s) => s.canvases.find((c) => c.id === canvasId))
  const viewport = useCanvasViewportStore((s) => s.byId[canvasId] ?? DEFAULT_VIEWPORT)
  const initViewport = useCanvasViewportStore((s) => s.initViewport)
  const setViewport = useCanvasViewportStore((s) => s.setViewport)

  const selected = useCanvasSelectionStore((s) => s.selected)
  const selectionSelect = useCanvasSelectionStore((s) => s.select)
  const selectionToggle = useCanvasSelectionStore((s) => s.toggle)
  const selectionClear = useCanvasSelectionStore((s) => s.clear)
  const selectionSelectAll = useCanvasSelectionStore((s) => s.selectAll)

  // 选中元素的 DOM 节点列表（渲染时查询，保证 Moveable target 是最新的）
  const selectedElements = Array.from(selected)
    .map((itemId) => document.querySelector<HTMLElement>(`[data-canvas-item-id="${itemId}"]`))
    .filter((el): el is HTMLElement => el !== null)

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

  // unmount：flush 视口 + 清空 items + 清空选区
  useEffect(() => {
    return () => {
      pendingDragCleanupRef.current?.()
      unload()
      selectionClear()
      const vp = useCanvasViewportStore.getState().byId[canvasId]
      if (vp) flushViewportNow(canvasId, vp)
    }
  }, [canvasId, unload, selectionClear])

  // 首次有 items 且视口为默认值时自动 fit
  useEffect(() => {
    if (items.length === 0 || didAutoFitRef.current) return
    const vp = useCanvasViewportStore.getState().byId[canvasId]
    if (vp && !(vp.x === 0 && vp.y === 0 && vp.scale === 1)) return
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
    const targetItems = selected.size > 0 ? items.filter((it) => selected.has(it.id)) : items
    setViewport(canvasId, fitViewport(targetItems.length > 0 ? targetItems : items, width, height, 0.1))
  }, [canvasId, items, selected, setViewport])

  // 四角旋转提交：把累积旋转增量写入 store
  const handleRotateCommit = useCallback((totalDeltaRad: number) => {
    const currentSelected = useCanvasSelectionStore.getState().selected
    const selectedItemsList = items.filter((it) => currentSelected.has(it.id))
    if (selectedItemsList.length === 0) return

    if (selectedItemsList.length === 1) {
      const item = selectedItemsList[0]
      flushSync(() => {
        updateItems([{ id: item.id, rotation: item.rotation + totalDeltaRad }])
      })
    } else {
      // 多选：各 item 绕选区重心旋转，位置同步更新
      const groupCx = selectedItemsList.reduce((s, it) => s + it.x, 0) / selectedItemsList.length
      const groupCy = selectedItemsList.reduce((s, it) => s + it.y, 0) / selectedItemsList.length
      const cos = Math.cos(totalDeltaRad)
      const sin = Math.sin(totalDeltaRad)
      const patches = selectedItemsList.map((item) => {
        const dx = item.x - groupCx
        const dy = item.y - groupCy
        return {
          id: item.id,
          x: groupCx + dx * cos - dy * sin,
          y: groupCy + dx * sin + dy * cos,
          rotation: item.rotation + totalDeltaRad,
        }
      })
      flushSync(() => { updateItems(patches) })
    }
    moveableRef.current?.updateRect()
  }, [items, updateItems])

  // ── wheel → 离散档位 zoom（以光标为锚点）──
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

  // ── 中键 / Space+左键 Pan ──
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const onPointerDown = (e: PointerEvent): void => {
      const isMid = e.button === 1
      const isSpaceLeft = spaceHeldRef.current && e.button === 0
      if (!isMid && !isSpaceLeft) return
      // preventDefault 同时阻止后续 click 事件，不会误触清空选区
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
      container.style.cursor = CURSOR_HAND_GRAB
    }

    const onPointerMove = (e: PointerEvent): void => {
      if (!isPanningRef.current || !panStartRef.current) return
      const dx = e.clientX - panStartRef.current.clientX
      const dy = e.clientY - panStartRef.current.clientY
      const currentScale =
        useCanvasViewportStore.getState().byId[canvasId]?.scale ?? panStartRef.current.vpScale
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
      container.style.cursor = spaceHeldRef.current ? CURSOR_HAND_OPEN : ''
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

  // ── Space / F / Esc / Ctrl+A 键盘 ──
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return

      if (e.code === 'Space') {
        e.preventDefault()
        spaceHeldRef.current = true
        if (containerRef.current && !isPanningRef.current) {
          containerRef.current.style.cursor = CURSOR_HAND_OPEN
        }
      } else if (e.key === 'f' || e.key === 'F') {
        handleFit()
      } else if (e.key === 'Escape') {
        selectionClear()
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault()
        selectionSelectAll(items)
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
  }, [handleFit, selectionClear, selectionSelectAll, items])

  const vp = viewport

  // viewport 变化（pan/zoom）后，同步 Moveable 手柄到 items 新位置
  // 用 useLayoutEffect：DOM commit 后、浏览器 paint 前执行，手柄与 items 同帧对齐
  useLayoutEffect(() => {
    if (selected.size > 0) {
      moveableRef.current?.updateRect()
    }
  }, [viewport, selected.size])

  return (
    <div
      ref={containerCallbackRef}
      className="relative w-full h-full overflow-hidden bg-canvas select-none"
      style={{ touchAction: 'none' }}
      onClick={() => {
        // 点击容器空白处清空选区
        // 框选刚完成时不清（onSelectEnd 会设 selectoJustSelectedRef）
        if (selectoJustSelectedRef.current) {
          selectoJustSelectedRef.current = false
          return
        }
        selectionClear()
      }}
    >
      {/* 画布元素（onClick stopPropagation，不会冒泡到容器的清空 handler） */}
      {items.map((item, i) => (
        <CanvasItemNode
          key={item.id}
          item={item}
          viewport={vp}
          index={i}
          selected={selected.has(item.id)}
          containerRef={containerRef}
          onPointerDown={(e) => {
            // Space 平移 / 非左键 / 修饰键 → 不干涉（onClick 处理修饰键）
            if (spaceHeldRef.current || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return
            // 已在选区内 → Moveable 原生 listener 处理，不重复触发
            if (selected.has(item.id)) return
            // 未选中 → 立即选中，但等到移动超过 8px 再启动拖拽（避免单击误触）
            flushSync(() => { selectionSelect([item.id]) })
            // 清理上一次未完成的等待
            pendingDragCleanupRef.current?.()
            const startX = e.clientX
            const startY = e.clientY
            const nativeEvent = e.nativeEvent
            let done = false
            const cleanup = (): void => {
              if (done) return
              done = true
              window.removeEventListener('pointermove', onMove)
              window.removeEventListener('pointerup', onUp)
              pendingDragCleanupRef.current = null
            }
            const onMove = (me: PointerEvent): void => {
              if (Math.hypot(me.clientX - startX, me.clientY - startY) > 8) {
                cleanup()
                moveableRef.current?.dragStart(nativeEvent)
              }
            }
            const onUp = cleanup
            window.addEventListener('pointermove', onMove)
            window.addEventListener('pointerup', onUp)
            pendingDragCleanupRef.current = cleanup
          }}
          onClick={(e) => {
            e.stopPropagation() // 防止容器 onClick 清空选区
            if (isPanningRef.current) return
            if (e.ctrlKey || e.metaKey) {
              selectionToggle(item.id)
            } else if (e.shiftKey) {
              const idx = items.findIndex((it) => it.id === item.id)
              useCanvasSelectionStore.getState().selectRange(idx, items)
            }
            // 无修饰键的单击选中已在 onPointerDown 完成，这里无需重复
          }}
        />
      ))}

      {/* 空态 */}
      {!loading && items.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <p className="text-sm text-muted-foreground">把图片或视频拖到侧栏画布开始</p>
        </div>
      )}

      {/* Moveable 变换手柄（始终挂载，target=[] 时不显示手柄） */}
      <Moveable
          ref={moveableRef}
          target={selectedElements}
          draggable={true}
          resizable={true}
          rotatable={true}
          keepRatio={true}
          renderDirections={['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se']}
          rotationPosition="none"
          snappable={false}
          origin={false}
          // ── 拖动（单选）──
          onDrag={(e) => {
            e.target.style.transform = e.transform
          }}
          onDragEnd={(e) => {
            if (!e.isDrag) return
            const el = e.target as HTMLElement
            const itemId = Number(el.dataset.canvasItemId)
            const item = items.find((it) => it.id === itemId)
            if (!item) return
            const scale = useCanvasViewportStore.getState().byId[canvasId]?.scale ?? 1
            // dist 是从拖动开始的总位移（不是 delta 单帧增量）
            const distX = (e.lastEvent?.dist?.[0] ?? 0) / scale
            const distY = (e.lastEvent?.dist?.[1] ?? 0) / scale
            // flushSync 强制 React 同步重渲染，写入正确 transform，再让 Moveable 读取位置
            flushSync(() => {
              updateItems([{ id: itemId, x: item.x + distX, y: item.y + distY }])
            })
            moveableRef.current?.updateRect()
          }}
          // ── 拖动（多选）──
          onDragGroup={(e) => {
            e.events.forEach((ev) => {
              ev.target.style.transform = ev.transform
            })
          }}
          onDragGroupEnd={(e) => {
            const scale = useCanvasViewportStore.getState().byId[canvasId]?.scale ?? 1
            const patches = e.events
              .filter((ev) => ev.isDrag)
              .map((ev) => {
                const el = ev.target as HTMLElement
                const itemId = Number(el.dataset.canvasItemId)
                const item = items.find((it) => it.id === itemId)
                if (!item) return null
                const distX = (ev.lastEvent?.dist?.[0] ?? 0) / scale
                const distY = (ev.lastEvent?.dist?.[1] ?? 0) / scale
                return { id: itemId, x: item.x + distX, y: item.y + distY }
              })
              .filter((p): p is NonNullable<typeof p> => p !== null)
            flushSync(() => {
              if (patches.length > 0) updateItems(patches)
            })
            moveableRef.current?.updateRect()
          }}
          // ── 缩放（单选）──
          onResizeStart={(e) => {
            setIsResizing(true)
            const ie = e.inputEvent as PointerEvent
            lockResizeCursor(ie.clientX, ie.clientY)
          }}
          onResize={(e) => {
            e.target.style.transform = e.drag.transform
            e.target.style.width = `${e.width}px`
            e.target.style.height = `${e.height}px`
          }}
          onResizeEnd={(e) => {
            setIsResizing(false)
            unlockResizeCursor()
            if (!e.isDrag) return
            const el = e.target as HTMLElement
            const itemId = Number(el.dataset.canvasItemId)
            const item = items.find((it) => it.id === itemId)
            if (!item) return
            const scale = useCanvasViewportStore.getState().byId[canvasId]?.scale ?? 1
            const newW = (e.lastEvent?.width ?? item.w * scale) / scale
            const newH = (e.lastEvent?.height ?? item.h * scale) / scale
            // drag.dist 是元素左上角的屏幕位移；中心还需额外加尺寸变化的一半
            const dragDistX = (e.lastEvent?.drag?.dist?.[0] ?? 0) / scale
            const dragDistY = (e.lastEvent?.drag?.dist?.[1] ?? 0) / scale
            flushSync(() => {
              updateItems([{
                id: itemId,
                w: newW,
                h: newH,
                x: item.x + dragDistX + (newW - item.w) / 2,
                y: item.y + dragDistY + (newH - item.h) / 2,
              }])
            })
            moveableRef.current?.updateRect()
          }}
          // ── 缩放（多选）──
          onResizeGroupStart={(e) => {
            setIsResizing(true)
            const ie = e.inputEvent as PointerEvent
            lockResizeCursor(ie.clientX, ie.clientY)
          }}
          onResizeGroup={(e) => {
            e.events.forEach((ev) => {
              ev.target.style.transform = ev.drag.transform
              ev.target.style.width = `${ev.width}px`
              ev.target.style.height = `${ev.height}px`
            })
          }}
          onResizeGroupEnd={(e) => {
            setIsResizing(false)
            unlockResizeCursor()
            const scale = useCanvasViewportStore.getState().byId[canvasId]?.scale ?? 1
            const patches = e.events
              .filter((ev) => ev.isDrag)
              .map((ev) => {
                const el = ev.target as HTMLElement
                const itemId = Number(el.dataset.canvasItemId)
                const item = items.find((it) => it.id === itemId)
                if (!item) return null
                const newW = (ev.lastEvent?.width ?? item.w * scale) / scale
                const newH = (ev.lastEvent?.height ?? item.h * scale) / scale
                const dragDistX = (ev.lastEvent?.drag?.dist?.[0] ?? 0) / scale
                const dragDistY = (ev.lastEvent?.drag?.dist?.[1] ?? 0) / scale
                return {
                  id: itemId,
                  w: newW,
                  h: newH,
                  x: item.x + dragDistX + (newW - item.w) / 2,
                  y: item.y + dragDistY + (newH - item.h) / 2,
                }
              })
              .filter((p): p is NonNullable<typeof p> => p !== null)
            flushSync(() => {
              if (patches.length > 0) updateItems(patches)
            })
            moveableRef.current?.updateRect()
          }}
          // ── 旋转（单选）──
          onRotate={(e) => {
            e.target.style.transform = e.drag.transform
          }}
          onRotateEnd={(e) => {
            if (!e.isDrag) return
            const el = e.target as HTMLElement
            const itemId = Number(el.dataset.canvasItemId)
            const item = items.find((it) => it.id === itemId)
            if (!item) return
            // dist 是从旋转开始的总角度（度），不是 delta 单帧增量
            const totalRotDeg = e.lastEvent?.dist ?? 0
            flushSync(() => {
              updateItems([{
                id: itemId,
                rotation: item.rotation + (totalRotDeg * Math.PI) / 180,
              }])
            })
            moveableRef.current?.updateRect()
          }}
          // ── 旋转（多选）──
          onRotateGroup={(e) => {
            e.events.forEach((ev) => {
              ev.target.style.transform = ev.drag.transform
            })
          }}
          onRotateGroupEnd={(e) => {
            const scale = useCanvasViewportStore.getState().byId[canvasId]?.scale ?? 1
            const patches = e.events
              .filter((ev) => ev.isDrag)
              .map((ev) => {
                const el = ev.target as HTMLElement
                const itemId = Number(el.dataset.canvasItemId)
                const item = items.find((it) => it.id === itemId)
                if (!item) return null
                const totalRotDeg = ev.lastEvent?.dist ?? 0
                const dragDistX = (ev.lastEvent?.drag?.dist?.[0] ?? 0) / scale
                const dragDistY = (ev.lastEvent?.drag?.dist?.[1] ?? 0) / scale
                return {
                  id: itemId,
                  rotation: item.rotation + (totalRotDeg * Math.PI) / 180,
                  x: item.x + dragDistX,
                  y: item.y + dragDistY,
                }
              })
              .filter((p): p is NonNullable<typeof p> => p !== null)
            flushSync(() => {
              if (patches.length > 0) updateItems(patches)
            })
            moveableRef.current?.updateRect()
          }}
        />

      {/* 四角旋转区：选中时在图片实际角点外侧渲染旋转热区 */}
      {selected.size > 0 && (
        <CornerRotateOverlay
          selectedItems={items.filter((it) => selected.has(it.id))}
          viewport={vp}
          containerRef={containerRef}
          moveableRef={moveableRef}
          onCommitRotation={handleRotateCommit}
          isResizing={isResizing}
        />
      )}

      {/* Selecto 框选 */}
      {containerEl && (
        <Selecto
          container={containerEl}
          selectableTargets={['.canvas-item']}
          hitRate={0}
          selectByClick={false}
          selectFromInside={false}
          continueSelect={false}
          toggleContinueSelect={['shift']}
          onSelect={(e) => {
            const addedIds = e.added.map((el) => Number((el as HTMLElement).dataset.canvasItemId))
            const removedIds = e.removed.map((el) =>
              Number((el as HTMLElement).dataset.canvasItemId)
            )
            const prev = useCanvasSelectionStore.getState().selected
            const next = new Set(prev)
            addedIds.forEach((id) => next.add(id))
            removedIds.forEach((id) => next.delete(id))
            useCanvasSelectionStore.setState({ selected: next })
          }}
          onSelectEnd={(e) => {
            if (e.selected.length > 0) {
              // 标记框选刚完成，阻止容器 onClick 误触发清空
              selectoJustSelectedRef.current = true
              moveableRef.current?.updateRect()
            }
          }}
        />
      )}

      {/* 底部工具栏 */}
      <CanvasToolbar viewport={vp} onFit={handleFit} />
    </div>
  )
}
