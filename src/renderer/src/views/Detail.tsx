import { useEffect, useRef, useState, useCallback } from 'react'
import { ArrowLeft, VideoOff } from 'lucide-react'
import clsx from 'clsx'
import { useDetailStore } from '../stores/detail'
import type { MediaItem } from '../../../main/recommender'

/**
 * 详情页（沉浸欣赏页）—— 全屏 fixed overlay（z-50），底层瀑布流不销毁。
 * 阶段 1：大图 blur-up + 视频单实例 + Esc/后退关闭 + 进出转场。
 */
export function DetailView(): React.JSX.Element | null {
  const isOpen = useDetailStore((s) => s.isOpen)
  const currentItem = useDetailStore((s) => s.currentItem)
  const close = useDetailStore((s) => s.close)

  // 转场：isOpen 变化后延一帧驱动 CSS opacity/transform
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (isOpen) {
      const raf = requestAnimationFrame(() => setVisible(true))
      return () => cancelAnimationFrame(raf)
    } else {
      setVisible(false)
    }
  }, [isOpen])

  // 打开时锁定 body 滚动，防止滚轮穿透到底层瀑布流
  useEffect(() => {
    if (isOpen) {
      const prev = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = prev }
    }
  }, [isOpen])

  // Esc 关闭
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, close])

  if (!isOpen && !visible) return null
  if (!currentItem) return null

  return (
    <div
      className={clsx(
        'fixed inset-0 z-50 bg-black flex items-center justify-center',
        'transition-opacity duration-300',
        visible ? 'opacity-100' : 'opacity-0'
      )}
      // 额外拦截 wheel，防止冒泡到 window 滚动
      onWheel={(e) => e.stopPropagation()}
    >
      {/* 后退按钮 */}
      <button
        onClick={close}
        className="absolute top-4 left-4 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm transition-colors backdrop-blur-sm"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>后退</span>
      </button>

      {/* 内容区 */}
      <div
        className={clsx(
          'w-full h-full flex items-center justify-center',
          'transition-transform duration-300',
          visible ? 'scale-100' : 'scale-95'
        )}
      >
        {currentItem.type === 'video' ? (
          <VideoPlayer item={currentItem} />
        ) : (
          <ImageViewer item={currentItem} />
        )}
      </div>
    </div>
  )
}

/** 图片查看器：blur-up（先渲染模糊 thumb，原图 onLoad 后淡入） */
function ImageViewer({ item }: { item: MediaItem }): React.JSX.Element {
  const [fullLoaded, setFullLoaded] = useState(false)
  const thumbUrl = `serendip://thumb/${item.id}`
  const fullUrl = `serendip://image/${item.id}`

  useEffect(() => {
    setFullLoaded(false)
  }, [item.id])

  return (
    <div className="relative w-full h-full flex items-center justify-center">
      {/* 模糊占位（原图加载完后 opacity→0，pointer-events-none 避免遮挡） */}
      <img
        src={thumbUrl}
        alt=""
        className={clsx(
          'absolute max-w-full max-h-full object-contain select-none pointer-events-none',
          'transition-opacity duration-500',
          fullLoaded ? 'opacity-0' : 'opacity-100'
        )}
        style={{ filter: 'blur(8px)', transform: 'scale(1.05)' }}
      />
      {/* 原图 */}
      <img
        src={fullUrl}
        alt=""
        className={clsx(
          'absolute max-w-full max-h-full object-contain select-none',
          'transition-opacity duration-500',
          fullLoaded ? 'opacity-100' : 'opacity-0'
        )}
        onLoad={() => setFullLoaded(true)}
        onError={() => console.warn(`Full image load failed: item ${item.id}`)}
      />
    </div>
  )
}

/** 视频播放器：单实例，组件卸载时立即停止解码 */
function VideoPlayer({ item }: { item: MediaItem }): React.JSX.Element {
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
      <div className="flex flex-col items-center gap-3 text-white/60">
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
      controls
      loop
      playsInline
      preload="auto"
      className="w-full h-full object-contain"
      onCanPlay={handleCanPlay}
      onError={handleError}
    />
  )
}
