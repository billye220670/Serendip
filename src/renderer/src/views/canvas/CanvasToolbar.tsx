import { Maximize2, PauseCircle, PlayCircle, Layers } from 'lucide-react'
import type { Viewport } from '../../lib/canvasMath'
import { ZOOM_STEP } from '../../lib/canvasMath'
import { useUIStore } from '../../stores/ui'

interface Props {
  viewport: Viewport
  onFit: () => void
}

export function CanvasToolbar({ viewport, onFit }: Props): React.JSX.Element {
  const level = Math.round(Math.log(viewport.scale) / Math.log(ZOOM_STEP))
  const label = level === 0 ? '0' : level > 0 ? `+${level}` : `${level}`
  const freezeVideos = useUIStore((s) => s.canvasFreezeVideos)
  const toggleFreeze = useUIStore((s) => s.toggleFreezeVideos)
  const autoTop = useUIStore((s) => s.canvasAutoTop)
  const toggleAutoTop = useUIStore((s) => s.toggleAutoTop)

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-0.5 bg-glass backdrop-blur-xl border border-border rounded-xl px-2.5 py-1.5 shadow-lg pointer-events-auto select-none">
      <span className="text-xs font-mono text-muted-foreground min-w-[3.5ch] text-center px-1">
        {label}
      </span>
      <button
        onClick={onFit}
        title="适应视口 (F)"
        className="p-1.5 rounded-lg hover:bg-sidebar-hover text-muted-foreground hover:text-foreground transition-colors"
      >
        <Maximize2 className="w-3.5 h-3.5" />
      </button>
      <div className="w-px h-4 bg-border mx-0.5" />
      <button
        onClick={toggleAutoTop}
        title={autoTop ? '自动置顶：开（点击关闭）' : '自动置顶：关（点击开启）'}
        className={`p-1.5 rounded-lg transition-colors ${
          autoTop
            ? 'text-accent hover:bg-sidebar-hover'
            : 'text-muted-foreground hover:bg-sidebar-hover hover:text-foreground'
        }`}
      >
        <Layers className="w-3.5 h-3.5" />
      </button>
      <div className="w-px h-4 bg-border mx-0.5" />
      <button
        onClick={toggleFreeze}
        title={freezeVideos ? '恢复视频播放' : '全部视频静止'}
        className={`p-1.5 rounded-lg transition-colors ${
          freezeVideos
            ? 'text-accent hover:bg-sidebar-hover'
            : 'text-muted-foreground hover:bg-sidebar-hover hover:text-foreground'
        }`}
      >
        {freezeVideos ? (
          <PlayCircle className="w-3.5 h-3.5" />
        ) : (
          <PauseCircle className="w-3.5 h-3.5" />
        )}
      </button>
    </div>
  )
}
