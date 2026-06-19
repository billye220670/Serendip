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
import { useCanvasUndoStore } from '../../stores/canvasUndo'
import { useUIStore } from '../../stores/ui'
import { fitViewport, clampScale, DEFAULT_VIEWPORT, ZOOM_STEP } from '../../lib/canvasMath'
import { navigateDirection, panToItem } from '../../lib/canvasNavigate'
import { CURSOR_HAND_OPEN, CURSOR_HAND_GRAB } from '../../lib/handCursor'
import { CanvasItemNode } from './CanvasItemNode'
import { CanvasToolbar } from './CanvasToolbar'
import type { CanvasItemPatch } from '../../../../main/canvases'

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

  // Pan cursor 用全局 * { cursor !important } 注入：容器自身的 style.cursor 会被
  // 元素的 inline cursor:'default' 和 Moveable 手柄 cursor 盖过，所以 hover 到元素上
  // 看不到 hand。全局 !important 才能让 Space 平移态的手型覆盖一切。
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
  // Space+左键 平移结束后的收尾 click 不应清空选区
  const panJustEndedRef = useRef(false)
  // 未选中元素 pointerDown 后，等待移动阈值才真正启动拖拽
  const pendingDragCleanupRef = useRef<(() => void) | null>(null)
  // 多选中按下某成员后是否真的拖了整组（用于区分"整组拖拽"与"点选收窄为单选"）
  const groupDragStartedRef = useRef(false)
  // 框选模式（仅空白处拖拽生效）：replace 替换 / add 加选(Shift) / subtract 减选(Ctrl)
  const marqueeModeRef = useRef<'replace' | 'add' | 'subtract'>('replace')
  // 框选开始时的选区快照（add/subtract 模式以它为基准实时计算）
  const marqueeStartRef = useRef<Set<number>>(new Set())
  // 本次框选是否真的发生了拖拽（用于阻止收尾 click 误清空选区）
  const marqueeActiveRef = useRef(false)
  // 手势（拖移/缩放/旋转）开始前的 item 快照，用于 undo 的 before 状态
  const gestureSnapshotRef = useRef<Map<number, { x: number; y: number; w: number; h: number; rotation: number }>>(new Map())

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

    let afterPatches: CanvasItemPatch[]

    if (selectedItemsList.length === 1) {
      const item = selectedItemsList[0]
      afterPatches = [{ id: item.id, rotation: item.rotation + totalDeltaRad }]
    } else {
      const groupCx = selectedItemsList.reduce((s, it) => s + it.x, 0) / selectedItemsList.length
      const groupCy = selectedItemsList.reduce((s, it) => s + it.y, 0) / selectedItemsList.length
      const cos = Math.cos(totalDeltaRad)
      const sin = Math.sin(totalDeltaRad)
      afterPatches = selectedItemsList.map((item) => {
        const dx = item.x - groupCx
        const dy = item.y - groupCy
        return {
          id: item.id,
          x: groupCx + dx * cos - dy * sin,
          y: groupCy + dx * sin + dy * cos,
          rotation: item.rotation + totalDeltaRad,
        }
      })
    }

    const beforePatches: CanvasItemPatch[] = selectedItemsList.map((it) => ({
      id: it.id, x: it.x, y: it.y, rotation: it.rotation,
    }))
    const finalAfter = afterPatches

    flushSync(() => { updateItems(finalAfter) })
    moveableRef.current?.updateRect()

    useCanvasUndoStore.getState().push({
      apply: () => {
        useCanvasItemsStore.getState().updateItems(finalAfter)
        moveableRef.current?.updateRect()
      },
      revert: () => {
        useCanvasItemsStore.getState().updateItems(beforePatches)
        moveableRef.current?.updateRect()
      },
    })
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
      setPanCursor(CURSOR_HAND_GRAB)
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
      // 平移收尾会触发容器 click，标记一下让 onClick 跳过清空选区
      panJustEndedRef.current = true
      setPanCursor(spaceHeldRef.current ? CURSOR_HAND_OPEN : null)
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
  }, [canvasId, setViewport, setPanCursor])

  // ── Space / F / Esc / Ctrl+A / Delete / [/] 层级 / Ctrl+Z/Y / 方向键 ──
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return

      if (e.code === 'Space') {
        e.preventDefault()
        spaceHeldRef.current = true
        if (!isPanningRef.current) setPanCursor(CURSOR_HAND_OPEN)

      } else if (e.key === 'f' || e.key === 'F') {
        handleFit()

      } else if (e.key === 'Escape') {
        selectionClear()

      } else if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault()
        useCanvasSelectionStore.getState().selectAll(useCanvasItemsStore.getState().items)

      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        const selIds = Array.from(useCanvasSelectionStore.getState().selected)
        if (selIds.length === 0) return
        const allItems = useCanvasItemsStore.getState().items
        const snapshots = allItems.filter((it) => selIds.includes(it.id))
        if (snapshots.length === 0) return

        void (async () => {
          await useCanvasItemsStore.getState().removeItems(canvasId, selIds)
          useCanvasSelectionStore.getState().clear()
          moveableRef.current?.updateRect()

          // 可撤销：revert 时重建（新 id），apply 时删除重建的 id
          const restoredIdsRef = { current: [] as number[] }
          useCanvasUndoStore.getState().push({
            apply: async () => {
              if (restoredIdsRef.current.length > 0) {
                await useCanvasItemsStore.getState().removeItems(canvasId, restoredIdsRef.current)
                restoredIdsRef.current = []
              }
              useCanvasSelectionStore.getState().clear()
              moveableRef.current?.updateRect()
            },
            revert: async () => {
              const inputs = snapshots.map((it) => ({
                fileId: it.fileId, x: it.x, y: it.y, w: it.w, h: it.h, z: it.z, rotation: it.rotation,
              }))
              const newIds = await window.api.addItemsToCanvas(canvasId, inputs)
              restoredIdsRef.current = newIds
              useCanvasItemsStore.getState().bump()
              moveableRef.current?.updateRect()
            },
          })
        })()

      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'BracketRight') {
        e.preventDefault()
        applyZOrder('bringToFront')
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'BracketLeft') {
        e.preventDefault()
        applyZOrder('sendToBack')
      } else if (!e.ctrlKey && !e.metaKey && !e.shiftKey && e.code === 'BracketRight') {
        e.preventDefault()
        applyZOrder('bringForward')
      } else if (!e.ctrlKey && !e.metaKey && !e.shiftKey && e.code === 'BracketLeft') {
        e.preventDefault()
        applyZOrder('sendBackward')

      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault()
        void useCanvasUndoStore.getState().undo().then(() => {
          requestAnimationFrame(() => { moveableRef.current?.updateRect() })
        })
      } else if (
        (e.ctrlKey || e.metaKey) &&
        (e.key === 'y' || e.key === 'Y' || (e.shiftKey && (e.key === 'z' || e.key === 'Z')))
      ) {
        e.preventDefault()
        void useCanvasUndoStore.getState().redo().then(() => {
          requestAnimationFrame(() => { moveableRef.current?.updateRect() })
        })

      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault()
        const allItems = useCanvasItemsStore.getState().items
        const selSet = useCanvasSelectionStore.getState().selected
        const container = containerRef.current
        if (!container || allItems.length === 0) return
        const { width, height } = container.getBoundingClientRect()
        const vp = useCanvasViewportStore.getState().byId[canvasId] ?? DEFAULT_VIEWPORT
        const newId = navigateDirection(
          e.key as 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown',
          allItems, selSet, vp, width, height,
        )
        if (newId === null) return
        useCanvasSelectionStore.getState().select([newId])
        const newItem = allItems.find((it) => it.id === newId)
        if (newItem) {
          const newVp = panToItem(newItem, vp, width, height)
          if (newVp) useCanvasViewportStore.getState().setViewport(canvasId, newVp)
        }
        requestAnimationFrame(() => { moveableRef.current?.updateRect() })
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
      setPanCursor(null)
    }
  }, [handleFit, selectionClear, canvasId, setPanCursor])

  const vp = viewport

  // 层级操作（[/] 和 Ctrl+Shift+[/]）：计算 z 补丁 + push undo
  const applyZOrder = useCallback((
    mode: 'bringForward' | 'sendBackward' | 'bringToFront' | 'sendToBack'
  ): void => {
    const selSet = useCanvasSelectionStore.getState().selected
    const allItems = useCanvasItemsStore.getState().items
    const selItems = allItems.filter((it) => selSet.has(it.id))
    if (selItems.length === 0) return

    let patches: CanvasItemPatch[] = []
    const nonSelItems = allItems.filter((it) => !selSet.has(it.id))

    if (mode === 'bringToFront' || (mode === 'bringForward' && selItems.length > 1)) {
      const maxZ = nonSelItems.length > 0 ? Math.max(...nonSelItems.map((it) => it.z)) : 0
      const sorted = [...selItems].sort((a, b) => a.z - b.z)
      patches = sorted.map((item, i) => ({ id: item.id, z: maxZ + i + 1 }))
    } else if (mode === 'sendToBack' || (mode === 'sendBackward' && selItems.length > 1)) {
      const minZ = nonSelItems.length > 0 ? Math.min(...nonSelItems.map((it) => it.z)) : 0
      const sorted = [...selItems].sort((a, b) => b.z - a.z)
      patches = sorted.map((item, i) => ({ id: item.id, z: minZ - i - 1 }))
    } else if (mode === 'bringForward') {
      const item = selItems[0]
      const above = allItems.filter((it) => it.id !== item.id && it.z > item.z).sort((a, b) => a.z - b.z)[0]
      if (!above) return
      patches = [{ id: item.id, z: above.z }, { id: above.id, z: item.z }]
    } else {
      const item = selItems[0]
      const below = allItems.filter((it) => it.id !== item.id && it.z < item.z).sort((a, b) => b.z - a.z)[0]
      if (!below) return
      patches = [{ id: item.id, z: below.z }, { id: below.id, z: item.z }]
    }

    if (patches.length === 0) return

    const beforePatches: CanvasItemPatch[] = patches.map((p) => ({
      id: p.id,
      z: allItems.find((it) => it.id === p.id)?.z ?? 0,
    }))
    const finalPatches = patches

    useCanvasItemsStore.getState().updateItems(finalPatches)
    moveableRef.current?.updateRect()

    useCanvasUndoStore.getState().push({
      apply: () => {
        useCanvasItemsStore.getState().updateItems(finalPatches)
        moveableRef.current?.updateRect()
      },
      revert: () => {
        useCanvasItemsStore.getState().updateItems(beforePatches)
        moveableRef.current?.updateRect()
      },
    })
  }, [])

  // 选中后自动置顶：保留选中项之间的相对 z 顺序，不压撤销栈
  useEffect(() => {
    if (selected.size === 0) return
    if (!useUIStore.getState().canvasAutoTop) return
    const allItems = useCanvasItemsStore.getState().items
    const selItems = allItems.filter((it) => selected.has(it.id))
    const nonSelItems = allItems.filter((it) => !selected.has(it.id))
    if (selItems.length === 0) return
    const nonSelMaxZ = nonSelItems.length > 0 ? Math.max(...nonSelItems.map((it) => it.z)) : 0
    // 已全部在最高层时跳过
    if (Math.min(...selItems.map((it) => it.z)) > nonSelMaxZ) return
    const sorted = [...selItems].sort((a, b) => a.z - b.z)
    const patches = sorted.map((item, i) => ({ id: item.id, z: nonSelMaxZ + i + 1 }))
    useCanvasItemsStore.getState().updateItems(patches)
  }, [selected])

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
        // Space+左键 平移刚结束时不清（平移是浏览画布，不应改变选区）
        if (panJustEndedRef.current) {
          panJustEndedRef.current = false
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

            const isSelected = selected.has(item.id)
            // 已在单选选区内 → Moveable 单元素手势绑在元素本身，原生 listener 直接处理
            if (isSelected && selected.size === 1) return

            // 未选中 → 立即单选（替换选区）；已在多选选区内 → 保持整组选区不变
            // 多选时 Moveable 处于 group 模式，下面手动 dragStart 会触发 onDragGroup
            // （group 拖拽手势绑在 Moveable 内部 areaElement 上，按在 item 上收不到，必须手动启动）
            if (!isSelected) {
              flushSync(() => { selectionSelect([item.id]) })
            }
            // 本次按下尚未拖动；若 >8px 启动整组拖拽时再置 true（用于 onClick 区分点选收窄）
            groupDragStartedRef.current = false
            // 等到移动超过 8px 再启动拖拽（避免单击误触）
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
                groupDragStartedRef.current = true
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
              // 画布是二维自由平面，没有"线性区间"概念（区间选择会顺带选中数组下标夹在中间的元素）
              // Shift+点选 = 把该元素并入选区（只加不减），与 Ctrl 的 toggle 区分
              const prev = useCanvasSelectionStore.getState().selected
              const next = new Set(prev)
              next.add(item.id)
              useCanvasSelectionStore.setState({ selected: next, anchor: item.id })
            } else if (!groupDragStartedRef.current && selected.size > 1 && selected.has(item.id)) {
              // 多选中无修饰键单击某成员（且未拖动整组）→ 收窄为只选该成员
              selectionSelect([item.id])
            }
            // 其余无修饰键单击（单选/未选元素）已在 onPointerDown 完成，这里无需重复
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
          // 多选时整体框的中央拖拽区改为穿透（pointer-events:none），
          // 否则它盖住选区 AABB 范围，挡住范围内其他未选图的点选。
          // 拖整组仍走 per-item onPointerDown（按住任一选中图），不依赖此中央区。
          passDragArea={true}
          // ── 拖动（单选）──
          onDragStart={(e) => {
            const el = e.target as HTMLElement
            const itemId = Number(el.dataset.canvasItemId)
            const item = useCanvasItemsStore.getState().items.find((it) => it.id === itemId)
            if (item) gestureSnapshotRef.current = new Map([[itemId, { x: item.x, y: item.y, w: item.w, h: item.h, rotation: item.rotation }]])
          }}
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
            const distX = (e.lastEvent?.dist?.[0] ?? 0) / scale
            const distY = (e.lastEvent?.dist?.[1] ?? 0) / scale
            const afterPatches = [{ id: itemId, x: item.x + distX, y: item.y + distY }]
            const snap = gestureSnapshotRef.current.get(itemId)
            const beforePatches = snap ? [{ id: itemId, x: snap.x, y: snap.y }] : null
            flushSync(() => { updateItems(afterPatches) })
            moveableRef.current?.updateRect()
            if (beforePatches) {
              const fa = afterPatches
              useCanvasUndoStore.getState().push({
                apply: () => { useCanvasItemsStore.getState().updateItems(fa); moveableRef.current?.updateRect() },
                revert: () => { useCanvasItemsStore.getState().updateItems(beforePatches); moveableRef.current?.updateRect() },
              })
            }
          }}
          // ── 拖动（多选）──
          onDragGroupStart={(e) => {
            const snap = new Map<number, { x: number; y: number; w: number; h: number; rotation: number }>()
            for (const ev of e.events) {
              const itemId = Number((ev.target as HTMLElement).dataset.canvasItemId)
              const item = useCanvasItemsStore.getState().items.find((it) => it.id === itemId)
              if (item) snap.set(itemId, { x: item.x, y: item.y, w: item.w, h: item.h, rotation: item.rotation })
            }
            gestureSnapshotRef.current = snap
          }}
          onDragGroup={(e) => {
            e.events.forEach((ev) => {
              ev.target.style.transform = ev.transform
            })
          }}
          onDragGroupEnd={(e) => {
            const scale = useCanvasViewportStore.getState().byId[canvasId]?.scale ?? 1
            const afterPatches = e.events
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
            const beforePatches: CanvasItemPatch[] = afterPatches.map((p) => {
              const snap = gestureSnapshotRef.current.get(p.id)
              return { id: p.id, x: snap?.x ?? p.x, y: snap?.y ?? p.y }
            })
            flushSync(() => { if (afterPatches.length > 0) updateItems(afterPatches) })
            moveableRef.current?.updateRect()
            if (afterPatches.length > 0) {
              const fa = afterPatches
              useCanvasUndoStore.getState().push({
                apply: () => { useCanvasItemsStore.getState().updateItems(fa); moveableRef.current?.updateRect() },
                revert: () => { useCanvasItemsStore.getState().updateItems(beforePatches); moveableRef.current?.updateRect() },
              })
            }
          }}
          // ── 缩放（单选）──
          onResizeStart={(e) => {
            setIsResizing(true)
            const ie = e.inputEvent as PointerEvent
            lockResizeCursor(ie.clientX, ie.clientY)
            const el = e.target as HTMLElement
            const itemId = Number(el.dataset.canvasItemId)
            const item = useCanvasItemsStore.getState().items.find((it) => it.id === itemId)
            if (item) gestureSnapshotRef.current = new Map([[itemId, { x: item.x, y: item.y, w: item.w, h: item.h, rotation: item.rotation }]])
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
            const dragDistX = (e.lastEvent?.drag?.dist?.[0] ?? 0) / scale
            const dragDistY = (e.lastEvent?.drag?.dist?.[1] ?? 0) / scale
            const afterPatches = [{
              id: itemId, w: newW, h: newH,
              x: item.x + dragDistX + (newW - item.w) / 2,
              y: item.y + dragDistY + (newH - item.h) / 2,
            }]
            const snap = gestureSnapshotRef.current.get(itemId)
            const beforePatches = snap ? [{ id: itemId, x: snap.x, y: snap.y, w: snap.w, h: snap.h }] : null
            flushSync(() => { updateItems(afterPatches) })
            moveableRef.current?.updateRect()
            if (beforePatches) {
              const fa = afterPatches
              useCanvasUndoStore.getState().push({
                apply: () => { useCanvasItemsStore.getState().updateItems(fa); moveableRef.current?.updateRect() },
                revert: () => { useCanvasItemsStore.getState().updateItems(beforePatches); moveableRef.current?.updateRect() },
              })
            }
          }}
          // ── 缩放（多选）──
          onResizeGroupStart={(e) => {
            setIsResizing(true)
            const ie = e.inputEvent as PointerEvent
            lockResizeCursor(ie.clientX, ie.clientY)
            const snap = new Map<number, { x: number; y: number; w: number; h: number; rotation: number }>()
            for (const ev of e.events) {
              const itemId = Number((ev.target as HTMLElement).dataset.canvasItemId)
              const item = useCanvasItemsStore.getState().items.find((it) => it.id === itemId)
              if (item) snap.set(itemId, { x: item.x, y: item.y, w: item.w, h: item.h, rotation: item.rotation })
            }
            gestureSnapshotRef.current = snap
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
            const afterPatches = e.events
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
                  id: itemId, w: newW, h: newH,
                  x: item.x + dragDistX + (newW - item.w) / 2,
                  y: item.y + dragDistY + (newH - item.h) / 2,
                }
              })
              .filter((p): p is NonNullable<typeof p> => p !== null)
            const beforePatches: CanvasItemPatch[] = afterPatches.map((p) => {
              const snap = gestureSnapshotRef.current.get(p.id)
              return { id: p.id, x: snap?.x ?? p.x, y: snap?.y ?? p.y, w: snap?.w ?? p.w, h: snap?.h ?? p.h }
            })
            flushSync(() => { if (afterPatches.length > 0) updateItems(afterPatches) })
            moveableRef.current?.updateRect()
            if (afterPatches.length > 0) {
              const fa = afterPatches
              useCanvasUndoStore.getState().push({
                apply: () => { useCanvasItemsStore.getState().updateItems(fa); moveableRef.current?.updateRect() },
                revert: () => { useCanvasItemsStore.getState().updateItems(beforePatches); moveableRef.current?.updateRect() },
              })
            }
          }}
          // ── 旋转（单选）──
          onRotateStart={(e) => {
            const el = e.target as HTMLElement
            const itemId = Number(el.dataset.canvasItemId)
            const item = useCanvasItemsStore.getState().items.find((it) => it.id === itemId)
            if (item) gestureSnapshotRef.current = new Map([[itemId, { x: item.x, y: item.y, w: item.w, h: item.h, rotation: item.rotation }]])
          }}
          onRotate={(e) => {
            e.target.style.transform = e.drag.transform
          }}
          onRotateEnd={(e) => {
            if (!e.isDrag) return
            const el = e.target as HTMLElement
            const itemId = Number(el.dataset.canvasItemId)
            const item = items.find((it) => it.id === itemId)
            if (!item) return
            const totalRotDeg = e.lastEvent?.dist ?? 0
            const afterPatches = [{ id: itemId, rotation: item.rotation + (totalRotDeg * Math.PI) / 180 }]
            const snap = gestureSnapshotRef.current.get(itemId)
            const beforePatches = snap ? [{ id: itemId, rotation: snap.rotation }] : null
            flushSync(() => { updateItems(afterPatches) })
            moveableRef.current?.updateRect()
            if (beforePatches) {
              const fa = afterPatches
              useCanvasUndoStore.getState().push({
                apply: () => { useCanvasItemsStore.getState().updateItems(fa); moveableRef.current?.updateRect() },
                revert: () => { useCanvasItemsStore.getState().updateItems(beforePatches); moveableRef.current?.updateRect() },
              })
            }
          }}
          // ── 旋转（多选）──
          onRotateGroupStart={(e) => {
            const snap = new Map<number, { x: number; y: number; w: number; h: number; rotation: number }>()
            for (const ev of e.events) {
              const itemId = Number((ev.target as HTMLElement).dataset.canvasItemId)
              const item = useCanvasItemsStore.getState().items.find((it) => it.id === itemId)
              if (item) snap.set(itemId, { x: item.x, y: item.y, w: item.w, h: item.h, rotation: item.rotation })
            }
            gestureSnapshotRef.current = snap
          }}
          onRotateGroup={(e) => {
            e.events.forEach((ev) => {
              ev.target.style.transform = ev.drag.transform
            })
          }}
          onRotateGroupEnd={(e) => {
            const scale = useCanvasViewportStore.getState().byId[canvasId]?.scale ?? 1
            const afterPatches = e.events
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
            const beforePatches: CanvasItemPatch[] = afterPatches.map((p) => {
              const snap = gestureSnapshotRef.current.get(p.id)
              return { id: p.id, rotation: snap?.rotation ?? p.rotation, x: snap?.x ?? p.x, y: snap?.y ?? p.y }
            })
            flushSync(() => { if (afterPatches.length > 0) updateItems(afterPatches) })
            moveableRef.current?.updateRect()
            if (afterPatches.length > 0) {
              const fa = afterPatches
              useCanvasUndoStore.getState().push({
                apply: () => { useCanvasItemsStore.getState().updateItems(fa); moveableRef.current?.updateRect() },
                revert: () => { useCanvasItemsStore.getState().updateItems(beforePatches); moveableRef.current?.updateRect() },
              })
            }
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
          onDragStart={(e) => {
            const inputEvent = e.inputEvent as PointerEvent
            const target = inputEvent.target as HTMLElement | null
            // Space 平移中 → 不框选（pan handler 处理）
            if (spaceHeldRef.current || inputEvent.button !== 0) {
              e.stop()
              return
            }
            // 按在 Moveable 手柄/控制框上 → 交给 Moveable，不框选
            if (target && moveableRef.current?.isMoveableElement(target)) {
              e.stop()
              return
            }
            // 按在画布元素上 → 交给 per-item onPointerDown（拖拽/单选/group 拖拽），不框选
            // 这是修复"拖拽选中元素时却拉出选区框、并把选区改成单张/误吞新元素"的关键
            if (target?.closest('.canvas-item')) {
              e.stop()
              return
            }
            // 空白处框选：记录模式 + 起始选区快照
            marqueeModeRef.current =
              inputEvent.ctrlKey || inputEvent.metaKey
                ? 'subtract'
                : inputEvent.shiftKey
                  ? 'add'
                  : 'replace'
            marqueeStartRef.current = new Set(useCanvasSelectionStore.getState().selected)
            marqueeActiveRef.current = false
          }}
          onSelect={(e) => {
            marqueeActiveRef.current = true
            // e.selected = 当前矩形覆盖到的全部目标（continueSelect=false，每次重新计算）
            const coveredIds = e.selected.map((el) => Number((el as HTMLElement).dataset.canvasItemId))
            const start = marqueeStartRef.current
            let next: Set<number>
            if (marqueeModeRef.current === 'add') {
              next = new Set(start)
              coveredIds.forEach((id) => next.add(id))
            } else if (marqueeModeRef.current === 'subtract') {
              next = new Set(start)
              coveredIds.forEach((id) => next.delete(id))
            } else {
              next = new Set(coveredIds)
            }
            useCanvasSelectionStore.setState({ selected: next })
          }}
          onSelectEnd={() => {
            // 真正拖了框 → 阻止收尾 click 清空选区 + 刷新手柄
            if (marqueeActiveRef.current) {
              selectoJustSelectedRef.current = true
              moveableRef.current?.updateRect()
            }
            marqueeActiveRef.current = false
          }}
        />
      )}

      {/* 底部工具栏 */}
      <CanvasToolbar viewport={vp} onFit={handleFit} />
    </div>
  )
}
