import { useRef } from 'react'
import { Presentation, X } from 'lucide-react'
import clsx from 'clsx'
import { useCurrentCanvasStore } from '../stores/currentCanvas'
import { useCanvasesStore } from '../stores/canvases'
import { useLibraryStore } from '../stores/library'
import type { View } from '../stores/library'

interface CurrentCanvasChipProps {
  style?: React.CSSProperties
}

export function CurrentCanvasChip({ style }: CurrentCanvasChipProps): React.JSX.Element | null {
  const currentCanvasId = useCurrentCanvasStore((s) => s.currentCanvasId)
  const setCurrent = useCurrentCanvasStore((s) => s.setCurrent)
  const canvases = useCanvasesStore((s) => s.canvases)
  const view = useLibraryStore((s) => s.view)
  const setView = useLibraryStore((s) => s.setView)

  // 记住最近一次非画布视图，用于关闭时回退
  const prevViewRef = useRef<View>({ kind: 'explore' })
  if (view.kind !== 'canvas') {
    prevViewRef.current = view
  }

  const currentCanvas = canvases.find((c) => c.id === currentCanvasId) ?? null
  const isCanvasView = view.kind === 'canvas'

  if (!currentCanvas) return null

  const handleClose = (e: React.MouseEvent): void => {
    e.stopPropagation()
    setCurrent(null)
    if (isCanvasView) setView(prevViewRef.current)
  }

  return (
    <div
      className={clsx(
        'flex items-center gap-2 rounded-lg border px-3 py-2 text-xs select-none cursor-pointer transition-colors',
        isCanvasView
          ? 'border-primary bg-primary/10 hover:bg-primary/15'
          : 'border-border bg-muted/60 hover:bg-muted'
      )}
      style={style}
      title="前往画布"
      onClick={() => {
        if (isCanvasView) {
          setView(prevViewRef.current)
        } else {
          setView({ kind: 'canvas', id: currentCanvas.id })
        }
      }}
    >
      <Presentation className={clsx('w-3.5 h-3.5 flex-shrink-0', isCanvasView ? 'text-primary' : 'text-muted-foreground')} />
      <span className={clsx('font-medium truncate max-w-[96px]', isCanvasView ? 'text-primary' : 'text-foreground')}>{currentCanvas.name}</span>
      <button
        className="ml-2 p-0.5 rounded hover:bg-border transition-colors text-muted-foreground hover:text-foreground flex-shrink-0"
        title="清除当前画布"
        onClick={handleClose}
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  )
}
