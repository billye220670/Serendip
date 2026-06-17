import { useEffect, useLayoutEffect, useRef, useCallback, useState } from 'react'
import { flushSync } from 'react-dom'
import Moveable from 'react-moveable'
import Selecto from 'react-selecto'
import { useCurrentCanvasStore } from '../../stores/currentCanvas'
import { useCanvasesStore } from '../../stores/canvases'
import { useCanvasItemsStore } from '../../stores/canvasItems'
import { useCanvasViewportStore, flushViewportNow } from '../../stores/canvasViewport'
import { useCanvasSelectionStore } from '../../stores/canvasSelection'
import { fitViewport, clampScale, DEFAULT_VIEWPORT, ZOOM_STEP } from '../../lib/canvasMath'
import { CanvasItemNode } from './CanvasItemNode'
import { CanvasToolbar } from './CanvasToolbar'

interface Props {
  canvasId: number
}

export function CanvasView({ canvasId }: Props): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null)
  const containerCallbackRef = useCallback((el: HTMLDivElement | null) => {
    containerRef.current = el
    setContainerEl(el)
  }, [])
  const moveableRef = useRef<InstanceType<typeof Moveable>>(null)
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
      container.style.cursor = 'grabbing'
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

  // ── Space / F / Esc / Ctrl+A 键盘 ──
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
          rotationPosition="top"
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
          onResize={(e) => {
            e.target.style.transform = e.drag.transform
            e.target.style.width = `${e.width}px`
            e.target.style.height = `${e.height}px`
          }}
          onResizeEnd={(e) => {
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
          onResizeGroup={(e) => {
            e.events.forEach((ev) => {
              ev.target.style.transform = ev.drag.transform
              ev.target.style.width = `${ev.width}px`
              ev.target.style.height = `${ev.height}px`
            })
          }}
          onResizeGroupEnd={(e) => {
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
