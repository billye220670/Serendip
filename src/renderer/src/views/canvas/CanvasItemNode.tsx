import { useState, useEffect, useRef } from 'react'
import type { CanvasItem } from '../../../../main/canvases'
import type { Viewport } from '../../lib/canvasMath'
import { CanvasVideoNode } from './CanvasVideoNode'

interface Props {
  item: CanvasItem
  viewport: Viewport
  index?: number
  selected?: boolean
  containerRef: React.RefObject<HTMLElement | null>
  onClick?: (e: React.MouseEvent) => void
  onPointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void
}

const baseImgStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  objectFit: 'contain',
  display: 'block',
  userSelect: 'none',
  pointerEvents: 'none',
  draggable: false,
} as React.CSSProperties

export function CanvasItemNode({ item, viewport, index = 0, selected = false, containerRef, onClick, onPointerDown }: Props): React.JSX.Element {
  const [fullResSrc, setFullResSrc] = useState<string | null>(null)
  const nodeRef = useRef<HTMLDivElement>(null)

  const screenW = item.w * viewport.scale
  const screenH = item.h * viewport.scale
  const screenCX = (item.x - viewport.x) * viewport.scale
  const screenCY = (item.y - viewport.y) * viewport.scale

  // 错开加载全图（仅图片）
  useEffect(() => {
    if (item.fileType === 'video') return
    let cancelled = false
    const timer = setTimeout(() => {
      const img = new Image()
      img.onload = () => {
        if (!cancelled) setFullResSrc(`serendip://image/${item.fileId}`)
      }
      img.src = `serendip://image/${item.fileId}`
    }, index * 150)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [item.fileId, item.fileType, index])

  return (
    <div
      ref={nodeRef}
      data-canvas-item-id={item.id}
      className="canvas-item"
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: screenW,
        height: screenH,
        transform: `translate(${screenCX - screenW / 2}px, ${screenCY - screenH / 2}px) rotate(${item.rotation}rad)`,
        transformOrigin: 'center',
        willChange: 'transform',
        overflow: 'hidden',
        cursor: 'default',
        outline: selected ? '2px solid var(--color-accent)' : 'none',
        outlineOffset: '2px',
        zIndex: item.z,
        boxShadow: selected ? '0 0 0 1px var(--color-accent)' : 'none',
      }}
      onClick={onClick}
      onPointerDown={onPointerDown}
    >
      {item.fileType === 'video' ? (
        <CanvasVideoNode
          fileId={item.fileId}
          screenW={screenW}
          screenH={screenH}
          selected={selected}
          containerRef={containerRef}
          nodeRef={nodeRef}
        />
      ) : (
        <>
          {/* 缩略图底层：始终存在，秒出占位 */}
          <img src={`serendip://thumb/${item.fileId}`} alt="" draggable={false} style={baseImgStyle} />
          {/* 全图层：预加载完成后淡入覆盖 */}
          {fullResSrc && (
            <img
              src={fullResSrc}
              alt=""
              draggable={false}
              style={{ ...baseImgStyle, animation: 'canvas-fadein 0.4s ease forwards' }}
            />
          )}
        </>
      )}
    </div>
  )
}
