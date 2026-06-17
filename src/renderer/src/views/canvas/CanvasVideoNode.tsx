import { useEffect, useRef, useState } from 'react'
import { useUIStore } from '../../stores/ui'

interface Props {
  fileId: number
  /** 元素在屏幕上的显示宽高（px），用于判断占比 */
  screenW: number
  screenH: number
  /** 是否被选中（选中时强制播放） */
  selected: boolean
  containerRef: React.RefObject<HTMLElement | null>
  /** CanvasItemNode 的根 div ref，用于 IntersectionObserver */
  nodeRef: React.RefObject<HTMLDivElement | null>
}

/** 视频屏幕占比低于此值时定格首帧 */
const MIN_AREA_RATIO = 0.05

export function CanvasVideoNode({ fileId, screenW, screenH, selected, containerRef, nodeRef }: Props): React.JSX.Element {
  const freezeAll = useUIStore((s) => s.canvasFreezeVideos)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [mounted, setMounted] = useState(false)
  const [isLargeEnough, setIsLargeEnough] = useState(false)

  // 判断屏幕占比是否超过 5%
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const { width, height } = container.getBoundingClientRect()
    const viewArea = width * height
    const itemArea = screenW * screenH
    setIsLargeEnough(viewArea > 0 && itemArea / viewArea > MIN_AREA_RATIO)
  }, [screenW, screenH, containerRef])

  // IntersectionObserver：出视口 → 卸载 video，入视口 → 挂载 video
  useEffect(() => {
    const container = containerRef.current
    const node = nodeRef.current
    if (!node) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        setMounted(entry.isIntersecting)
      },
      { root: container, threshold: 0 }
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [containerRef, nodeRef])

  // 全局静止 / 选中 / 占比 → 控制播放
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (freezeAll) {
      video.pause()
      return
    }
    const shouldPlay = selected || isLargeEnough
    if (shouldPlay) {
      void video.play().catch(() => {})
    } else {
      video.pause()
    }
  }, [freezeAll, selected, isLargeEnough, mounted])

  return (
    <>
      {/* 首帧缩略图：始终显示作为底层 */}
      <img
        src={`serendip://thumb/${fileId}`}
        alt=""
        draggable={false}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          display: 'block',
          userSelect: 'none',
          pointerEvents: 'none',
        }}
      />
      {/* video 节点：仅在入视口时挂载，全局静止或占比不足时暂停 */}
      {mounted && (
        <video
          ref={videoRef}
          src={`serendip://video/${fileId}`}
          autoPlay={!freezeAll && (selected || isLargeEnough)}
          muted
          loop
          playsInline
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            display: 'block',
            userSelect: 'none',
            pointerEvents: 'none',
          }}
        />
      )}
    </>
  )
}
