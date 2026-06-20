import { Maximize2, PauseCircle, PlayCircle, Layers, Video, LayoutGrid } from 'lucide-react'
import type { Viewport } from '../../lib/canvasMath'
import { ZOOM_STEP } from '../../lib/canvasMath'
import { useUIStore } from '../../stores/ui'
import { useCameraShakeStore } from '../../stores/cameraShake'
import { Tooltip } from '../../components/Tooltip'
import { CameraShakeControls } from './CameraShakeControls'

interface Props {
  viewport: Viewport
  onFit: () => void
  onRearrange: () => void
}

export function CanvasToolbar({ viewport, onFit, onRearrange }: Props): React.JSX.Element {
  const level = Math.round(Math.log(viewport.scale) / Math.log(ZOOM_STEP))
  const label = level === 0 ? '0' : level > 0 ? `+${level}` : `${level}`
  const freezeVideos = useUIStore((s) => s.canvasFreezeVideos)
  const toggleFreeze = useUIStore((s) => s.toggleFreezeVideos)
  const autoTop = useUIStore((s) => s.canvasAutoTop)
  const toggleAutoTop = useUIStore((s) => s.toggleAutoTop)
  const shakeEnabled = useCameraShakeStore((s) => s.enabled)
  const toggleShake = useCameraShakeStore((s) => s.toggleEnabled)

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-0.5 bg-glass backdrop-blur-xl border border-border rounded-xl px-2.5 py-1.5 shadow-lg pointer-events-auto select-none">
      <span className="text-xs font-mono text-muted-foreground min-w-[3.5ch] text-center px-1">
        {label}
      </span>
      <Tooltip text="适应视口 (F)" side="top">
        <button
          onClick={onFit}
          className="p-1.5 rounded-lg hover:bg-sidebar-hover text-muted-foreground hover:text-foreground transition-colors"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
      </Tooltip>
      <Tooltip text="重排为网格" side="top">
        <button
          onClick={onRearrange}
          className="p-1.5 rounded-lg hover:bg-sidebar-hover text-muted-foreground hover:text-foreground transition-colors"
        >
          <LayoutGrid className="w-3.5 h-3.5" />
        </button>
      </Tooltip>
      <div className="w-px h-4 bg-border mx-0.5" />
      <Tooltip text={autoTop ? '自动置顶：开（点击关闭）' : '自动置顶：关（点击开启）'} side="top">
        <button
          onClick={toggleAutoTop}
          className={`p-1.5 rounded-lg transition-colors ${
            autoTop
              ? 'text-primary hover:bg-sidebar-hover'
              : 'text-muted-foreground hover:bg-sidebar-hover hover:text-foreground'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
        </button>
      </Tooltip>
      <div className="w-px h-4 bg-border mx-0.5" />
      <Tooltip text={freezeVideos ? '恢复视频播放' : '全部视频静止'} side="top">
        <button
          onClick={toggleFreeze}
          className={`p-1.5 rounded-lg transition-colors ${
            freezeVideos
              ? 'text-primary hover:bg-sidebar-hover'
              : 'text-muted-foreground hover:bg-sidebar-hover hover:text-foreground'
          }`}
        >
          {freezeVideos ? (
            <PlayCircle className="w-3.5 h-3.5" />
          ) : (
            <PauseCircle className="w-3.5 h-3.5" />
          )}
        </button>
      </Tooltip>
      <div className="w-px h-4 bg-border mx-0.5" />
      {/* 摄影机手摇总开关（高亮为主题色）+ 右侧常驻控件（关闭时灰化不可用） */}
      <Tooltip text={shakeEnabled ? '关闭摄影机手摇' : '开启摄影机手摇'} side="top">
        <button
          onClick={toggleShake}
          className={`p-1.5 rounded-lg transition-colors ${
            shakeEnabled
              ? 'text-primary hover:bg-sidebar-hover'
              : 'text-muted-foreground hover:bg-sidebar-hover hover:text-foreground'
          }`}
        >
          <Video className="w-3.5 h-3.5" />
        </button>
      </Tooltip>
      <CameraShakeControls disabled={!shakeEnabled} />
    </div>
  )
}
