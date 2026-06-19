import { useState, useEffect, useRef } from 'react'
import type { CanvasItem } from '../../../../main/canvases'
import type { Viewport } from '../../lib/canvasMath'
import { CanvasVideoNode } from './CanvasVideoNode'
import { clipPolygonToCSS, parseClipData } from '../../lib/clipPolygon'

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
  draggable: false
} as React.CSSProperties

export function CanvasItemNode({
  item,
  viewport,
  index = 0,
  selected = false,
  containerRef,
  onClick,
  onPointerDown
}: Props): React.JSX.Element {
  const [fullResSrc, setFullResSrc] = useState<string | null>(null)
  const nodeRef = useRef<HTMLDivElement>(null)

  const screenW = item.w * viewport.scale
  const screenH = item.h * viewport.scale
  const screenCX = (item.x - viewport.x) * viewport.scale
  const screenCY = (item.y - viewport.y) * viewport.scale

  // 裁剪数据：clip（外层框归一化多边形）+ content（图像在框内的旋转矩形放置）
  const clipData = parseClipData(item.clipPolygon)
  const clipPath = clipData ? clipPolygonToCSS(item.clipPolygon) : undefined

  // 内层媒体的渲染尺寸：未裁剪时填满整框；裁剪后为 content 的世界尺寸×scale
  const mediaW = clipData ? clipData.content.w * viewport.scale : screenW
  const mediaH = clipData ? clipData.content.h * viewport.scale : screenH

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

  // 内层媒体（视频 / 双层图片）——填满它所在的容器（整框 或 content 包裹层）
  const media =
    item.fileType === 'video' ? (
      <CanvasVideoNode
        fileId={item.fileId}
        screenW={mediaW}
        screenH={mediaH}
        selected={selected}
        containerRef={containerRef}
        nodeRef={nodeRef}
      />
    ) : (
      <>
        {/* 缩略图底层：始终存在，秒出占位 */}
        <img
          src={`serendip://thumb/${item.fileId}`}
          alt=""
          draggable={false}
          style={baseImgStyle}
        />
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
    )

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
        // 裁剪：clip-path 在外层框（width×height）内、transform 之前生效，
        // 故归一化多边形不受 rotate 影响。
        clipPath,
        cursor: 'default',
        outline: selected ? '2px solid var(--color-accent)' : 'none',
        outlineOffset: '2px',
        zIndex: item.z,
        boxShadow: selected ? '0 0 0 1px var(--color-accent)' : 'none'
      }}
      onClick={onClick}
      onPointerDown={onPointerDown}
    >
      {clipData ? (
        // 裁剪后：图像内容与外层框解耦，单独按 content 旋转矩形定位（保持原朝向）。
        // 用世界单位×scale 的像素定位（box-pixel 空间是世界的均匀缩放，旋转无畸变）。
        // class canvas-content 供 CanvasView 的 resize 拖拽实时同步内容尺寸。
        <div
          className="canvas-content"
          style={{
            position: 'absolute',
            left: screenW / 2 + clipData.content.cx * viewport.scale - mediaW / 2,
            top: screenH / 2 + clipData.content.cy * viewport.scale - mediaH / 2,
            width: mediaW,
            height: mediaH,
            transform: `rotate(${clipData.content.rot}rad)`,
            transformOrigin: 'center'
          }}
        >
          {media}
        </div>
      ) : (
        media
      )}
    </div>
  )
}
