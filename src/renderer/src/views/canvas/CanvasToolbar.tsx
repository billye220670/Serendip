import { Maximize2 } from 'lucide-react'
import type { Viewport } from '../../lib/canvasMath'
import { ZOOM_STEP } from '../../lib/canvasMath'

interface Props {
  viewport: Viewport
  onFit: () => void
}

export function CanvasToolbar({ viewport, onFit }: Props): React.JSX.Element {
  const level = Math.round(Math.log(viewport.scale) / Math.log(ZOOM_STEP))
  const label = level === 0 ? '0' : level > 0 ? `+${level}` : `${level}`

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
    </div>
  )
}
