import { useEffect, useRef } from 'react'
import type Moveable from 'react-moveable'
import type { CanvasItem } from '../../../../main/canvases'
import type { Viewport } from '../../lib/canvasMath'

interface Props {
  selectedItems: CanvasItem[]
  viewport: Viewport
  containerRef: React.RefObject<HTMLElement | null>
  moveableRef: React.RefObject<InstanceType<typeof Moveable> | null>
  onCommitRotation: (totalDeltaRad: number) => void
  isResizing?: boolean
}

// 鼠标距图片角点的检测区间（屏幕像素）
const MIN_CORNER_GAP = 10  // 内边界：避开 Moveable resize 手柄
const ROTATION_RADIUS = 16 // 外边界：感应范围

// 用户提供的旋转箭头路径（原始 viewBox 1024×1024）
const ROTATE_ICON_PATH =
  'M581.01362184 687.36248173L740.53691168 1007.54043226l159.52328984-320.17795053-115.39982669 0c-3.39411255-53.17442995-15.8391919-106.34885989-36.2038672-156.12917728-12.44507935-28.28427125-26.02152955-55.43717165-45.254834-81.45870119-16.97056275-26.02152955-36.2038672-49.7803174-58.83128419-70.1449927-21.49604615-21.49604615-45.254834-40.7293506-70.1449927-58.83128419-26.02152955-16.97056275-53.17442995-32.80975465-81.45870119-45.254834-50.91168825-21.49604615-101.82337649-33.9411255-156.12917728-36.2038672l0-115.39982669L16.45956774 283.46308832l320.17795053 159.52328984 0-108.61160159c41.86072145 3.39411255 80.32733034 12.44507935 118.79393924 28.28427124 46.38620485 19.23330445 87.11555544 46.38620485 122.18805178 81.4587012s62.22539674 75.80184694 81.4587012 122.18805179c15.8391919 38.4666089 26.02152955 78.06458864 28.28427124 118.79393923l-106.34885989 2.2627417z'

function makeRotateCursor(rotateDeg: number): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 1024 1024">` +
    `<defs><filter id="s" x="-25%" y="-25%" width="150%" height="150%">` +
    `<feDropShadow dx="0" dy="30" stdDeviation="35" flood-opacity="0.45"/>` +
    `</filter></defs>` +
    `<g transform="rotate(${rotateDeg},512,512)">` +
    `<path d="${ROTATE_ICON_PATH}" fill="white" filter="url(#s)"/>` +
    `<path d="${ROTATE_ICON_PATH}" fill="none" stroke="rgba(0,0,0,0.5)" stroke-width="30"/>` +
    `</g>` +
    `</svg>`
  return `url("data:image/svg+xml;base64,${btoa(svg)}") 16 16, pointer`
}

// SVG 默认方向 = NE；8 方位各旋转对应角度
// atan2 屏幕坐标系（Y 向下）: E=0° SE=45° S=90° SW=135° W=180° NW=225° N=270° NE=315°
const DIR_CURSORS = {
  ne: makeRotateCursor(0),
  e:  makeRotateCursor(45),
  se: makeRotateCursor(90),
  s:  makeRotateCursor(135),
  sw: makeRotateCursor(180),
  w:  makeRotateCursor(225),
  nw: makeRotateCursor(270),
  n:  makeRotateCursor(315),
}

function getDirCursor(mouseX: number, mouseY: number, centerX: number, centerY: number): string {
  const deg = (Math.atan2(mouseY - centerY, mouseX - centerX) * (180 / Math.PI) + 360) % 360
  if (deg < 22.5 || deg >= 337.5) return DIR_CURSORS.e
  if (deg < 67.5)  return DIR_CURSORS.se
  if (deg < 112.5) return DIR_CURSORS.s
  if (deg < 157.5) return DIR_CURSORS.sw
  if (deg < 202.5) return DIR_CURSORS.w
  if (deg < 247.5) return DIR_CURSORS.nw
  if (deg < 292.5) return DIR_CURSORS.n
  return DIR_CURSORS.ne
}

interface ZoneResult {
  inZone: boolean
  center: { x: number; y: number }
}

/**
 * 判断鼠标是否处于旋转感应区：
 * 1. 鼠标在图片矩形"外侧"（变换到本地坐标后超出 half-extent）
 * 2. 且距任一角点的屏幕距离在 [MIN_CORNER_GAP, ROTATION_RADIUS]
 */
function checkRotationZone(
  mouseX: number,
  mouseY: number,
  items: CanvasItem[],
  viewport: Viewport,
  containerRect: DOMRect,
): ZoneResult {
  if (items.length === 0) return { inZone: false, center: { x: 0, y: 0 } }

  if (items.length === 1) {
    const item = items[0]
    const cx = (item.x - viewport.x) * viewport.scale + containerRect.left
    const cy = (item.y - viewport.y) * viewport.scale + containerRect.top
    const hw = (item.w * viewport.scale) / 2
    const hh = (item.h * viewport.scale) / 2
    const cos = Math.cos(item.rotation)
    const sin = Math.sin(item.rotation)

    // 鼠标变换到图片本地坐标
    const dx = mouseX - cx
    const dy = mouseY - cy
    const localX = dx * cos + dy * sin
    const localY = -dx * sin + dy * cos
    const isOutside = Math.abs(localX) > hw || Math.abs(localY) > hh

    if (!isOutside) return { inZone: false, center: { x: cx, y: cy } }

    // 检查距四个角点的屏幕距离
    const corners: [number, number][] = [
      [cx + (-hw * cos - (-hh) * sin), cy + (-hw * sin + (-hh) * cos)],
      [cx + (hw * cos - (-hh) * sin),  cy + (hw * sin + (-hh) * cos)],
      [cx + (hw * cos - hh * sin),     cy + (hw * sin + hh * cos)],
      [cx + (-hw * cos - hh * sin),    cy + (-hw * sin + hh * cos)],
    ]
    for (const [cx2, cy2] of corners) {
      const dist = Math.hypot(mouseX - cx2, mouseY - cy2)
      if (dist >= MIN_CORNER_GAP && dist <= ROTATION_RADIUS) {
        return { inZone: true, center: { x: cx, y: cy } }
      }
    }
    return { inZone: false, center: { x: cx, y: cy } }
  }

  // 多选：用所有旋转角点的 AABB
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  let sumCx = 0, sumCy = 0
  for (const item of items) {
    const cx = (item.x - viewport.x) * viewport.scale + containerRect.left
    const cy = (item.y - viewport.y) * viewport.scale + containerRect.top
    sumCx += cx; sumCy += cy
    const hw = (item.w * viewport.scale) / 2
    const hh = (item.h * viewport.scale) / 2
    const cos = Math.cos(item.rotation)
    const sin = Math.sin(item.rotation)
    for (const [ldx, ldy] of [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]] as const) {
      minX = Math.min(minX, cx + ldx * cos - ldy * sin)
      minY = Math.min(minY, cy + ldx * sin + ldy * cos)
      maxX = Math.max(maxX, cx + ldx * cos - ldy * sin)
      maxY = Math.max(maxY, cy + ldx * sin + ldy * cos)
    }
  }
  const bCx = (minX + maxX) / 2
  const bCy = (minY + maxY) / 2
  const center = { x: sumCx / items.length, y: sumCy / items.length }

  // 在 AABB 外侧且距角点在感应区
  const isOutside = mouseX < minX || mouseX > maxX || mouseY < minY || mouseY > maxY
  if (!isOutside) return { inZone: false, center }

  const boxCorners: [number, number][] = [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]]
  for (const [cx2, cy2] of boxCorners) {
    const dist = Math.hypot(mouseX - cx2, mouseY - cy2)
    if (dist >= MIN_CORNER_GAP && dist <= ROTATION_RADIUS) {
      return { inZone: true, center: { x: bCx, y: bCy } }
    }
  }
  return { inZone: false, center }
}

export function CornerRotateOverlay({
  selectedItems,
  viewport,
  containerRef,
  moveableRef,
  onCommitRotation,
  isResizing = false,
}: Props): null {
  // 用 ref 镜像所有 props，避免 effect 因每次渲染的新引用重新注册监听
  const itemsRef = useRef(selectedItems)
  const viewportRef = useRef(viewport)
  const onCommitRef = useRef(onCommitRotation)
  const isResizingRef = useRef(isResizing)

  itemsRef.current = selectedItems
  viewportRef.current = viewport
  onCommitRef.current = onCommitRotation
  isResizingRef.current = isResizing

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // hover cursor 注入/移除
    let hoverStyle: HTMLStyleElement | null = null

    const onMouseMove = (e: PointerEvent): void => {
      if (isResizingRef.current) {
        if (hoverStyle) { document.head.removeChild(hoverStyle); hoverStyle = null }
        return
      }
      const items = itemsRef.current
      if (items.length === 0) {
        if (hoverStyle) { document.head.removeChild(hoverStyle); hoverStyle = null }
        return
      }
      const rect = container.getBoundingClientRect()
      const { inZone, center } = checkRotationZone(e.clientX, e.clientY, items, viewportRef.current, rect)
      if (inZone) {
        const cur = getDirCursor(e.clientX, e.clientY, center.x, center.y)
        const text = `* { cursor: ${cur} !important; }`
        if (!hoverStyle) {
          hoverStyle = document.createElement('style')
          document.head.appendChild(hoverStyle)
        }
        if (hoverStyle.textContent !== text) hoverStyle.textContent = text
      } else {
        if (hoverStyle) { document.head.removeChild(hoverStyle); hoverStyle = null }
      }
    }

    const onPointerDown = (e: PointerEvent): void => {
      if (e.button !== 0) return
      if (isResizingRef.current) return
      const items = itemsRef.current
      if (items.length === 0) return

      const rect = container.getBoundingClientRect()
      const { inZone, center } = checkRotationZone(e.clientX, e.clientY, items, viewportRef.current, rect)
      if (!inZone) return

      // 吃掉事件，不让 Moveable 或选区逻辑处理
      e.stopPropagation()
      e.preventDefault()

      // 移除 hover style，换成拖拽 cursor 锁
      if (hoverStyle) { document.head.removeChild(hoverStyle); hoverStyle = null }
      const dragCursor = getDirCursor(e.clientX, e.clientY, center.x, center.y)
      const cursorStyle = document.createElement('style')
      cursorStyle.textContent = `* { cursor: ${dragCursor} !important; }`
      document.head.appendChild(cursorStyle)

      const centerRef2 = { ...center }
      let startAngle = Math.atan2(e.clientY - centerRef2.y, e.clientX - centerRef2.x)
      let totalDelta = 0

      const vp = viewportRef.current
      const isSingle = items.length === 1
      const groupCx = items.reduce((s, it) => s + it.x, 0) / items.length
      const groupCy = items.reduce((s, it) => s + it.y, 0) / items.length

      const initialStates = items.map((item) => {
        const el = container.querySelector<HTMLElement>(`[data-canvas-item-id="${item.id}"]`)
        const scale = vp.scale
        return {
          item,
          el,
          screenW: item.w * scale,
          screenH: item.h * scale,
          screenCX: (item.x - vp.x) * scale,
          screenCY: (item.y - vp.y) * scale,
        }
      })

      const onMove = (me: PointerEvent): void => {
        const { x, y } = centerRef2
        const qCursor = getDirCursor(me.clientX, me.clientY, x, y)
        const next = `* { cursor: ${qCursor} !important; }`
        if (cursorStyle.textContent !== next) cursorStyle.textContent = next

        const currentAngle = Math.atan2(me.clientY - y, me.clientX - x)
        const deltaRad = currentAngle - startAngle
        startAngle = currentAngle
        totalDelta += deltaRad
        const total = totalDelta
        const cos = Math.cos(total)
        const sin = Math.sin(total)

        for (const { item, el, screenW, screenH, screenCX, screenCY } of initialStates) {
          if (!el) continue
          if (isSingle) {
            const newRot = item.rotation + total
            el.style.transform = `translate(${screenCX - screenW / 2}px, ${screenCY - screenH / 2}px) rotate(${newRot}rad)`
          } else {
            const dx = item.x - groupCx
            const dy = item.y - groupCy
            const newWorldX = groupCx + dx * cos - dy * sin
            const newWorldY = groupCy + dx * sin + dy * cos
            const newScreenCX = (newWorldX - vp.x) * vp.scale
            const newScreenCY = (newWorldY - vp.y) * vp.scale
            const newRot = item.rotation + total
            el.style.transform = `translate(${newScreenCX - screenW / 2}px, ${newScreenCY - screenH / 2}px) rotate(${newRot}rad)`
          }
        }
        moveableRef.current?.updateRect()
      }

      const onUp = (): void => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        document.head.removeChild(cursorStyle)

        // 防止 pointerup 后的 click 冒泡清空选区
        const swallowClick = (ce: MouseEvent): void => ce.stopPropagation()
        window.addEventListener('click', swallowClick, { capture: true, once: true })

        if (Math.abs(totalDelta) > 0.001) {
          onCommitRef.current(totalDelta)
        }
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    }

    window.addEventListener('pointermove', onMouseMove)
    // capture 拦截，在 Moveable / Selecto 之前处理
    container.addEventListener('pointerdown', onPointerDown, { capture: true })

    return () => {
      window.removeEventListener('pointermove', onMouseMove)
      container.removeEventListener('pointerdown', onPointerDown, { capture: true })
      if (hoverStyle) { document.head.removeChild(hoverStyle); hoverStyle = null }
    }
  }, [containerRef, moveableRef])

  return null
}
