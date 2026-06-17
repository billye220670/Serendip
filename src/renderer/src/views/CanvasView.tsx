import { useEffect } from 'react'
import { Presentation } from 'lucide-react'
import { useCurrentCanvasStore } from '../stores/currentCanvas'
import { useCanvasesStore } from '../stores/canvases'

export function CanvasView({ canvasId }: { canvasId: number }): React.JSX.Element {
  const setCurrent = useCurrentCanvasStore((s) => s.setCurrent)
  const canvases = useCanvasesStore((s) => s.canvases)
  const canvas = canvases.find((c) => c.id === canvasId)

  useEffect(() => {
    setCurrent(canvasId)
  }, [canvasId, setCurrent])

  return (
    <div className="h-full flex flex-col items-center justify-center gap-6 text-muted-foreground">
      <Presentation className="w-16 h-16 opacity-30" />
      <div className="text-center">
        <p className="text-lg font-medium text-foreground mb-1">
          {canvas ? `「${canvas.name}」` : '画布'}
        </p>
        <p className="text-sm">画布功能开发中</p>
        <p className="text-xs mt-1 opacity-60">阶段 2 将实装 pan/zoom 与元素渲染</p>
      </div>
    </div>
  )
}
