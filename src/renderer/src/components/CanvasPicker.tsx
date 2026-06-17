import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Search, Plus, Presentation } from 'lucide-react'
import clsx from 'clsx'
import type { Canvas } from '../../../main/canvases'
import { IPC } from '../../../main/ipc/contract'

export interface CanvasPickerProps {
  x: number
  y: number
  placement?: 'top' | 'bottom' | 'cursor'
  alignRight?: boolean
  triggerRef?: React.RefObject<HTMLElement | null>
  canvases: Canvas[]
  onSelect: (canvasId: number) => void
  onCreateAndSelect: (name: string) => void
  onClose: () => void
}

export function CanvasPicker({
  x,
  y,
  placement = 'top',
  alignRight = false,
  triggerRef,
  canvases,
  onSelect,
  onCreateAndSelect,
  onClose
}: CanvasPickerProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [search, setSearch] = useState('')
  // 对于 top 模式用 bottom 定位，面板高度变化时底部固定不动；bottom/cursor 用 top 定位
  const [position, setPosition] = useState<{ left: number; top?: number; bottom?: number }>({ left: x })

  const filtered = canvases.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  )
  const showCreate = search.trim().length > 0 && filtered.length === 0

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const margin = 8
    let left = alignRight ? x - rect.width : (placement === 'top' ? x - rect.width / 2 : x)

    if (left + rect.width + margin > window.innerWidth) left = window.innerWidth - rect.width - margin
    if (left < margin) left = margin

    if (placement === 'top') {
      // bottom 锚定：面板底部固定在 y - margin，高度变化向上撑
      const bottom = window.innerHeight - y + margin
      setPosition({ left, bottom })
    } else {
      let top = y + margin
      if (top + rect.height + margin > window.innerHeight) top = Math.max(margin, window.innerHeight - rect.height - margin)
      if (top < margin) top = margin
      setPosition({ left, top })
    }
    inputRef.current?.focus()
  }, [x, y, placement, alignRight])

  useEffect(() => {
    const onPointerDown = (e: MouseEvent): void => {
      const target = e.target as Node
      if (ref.current?.contains(target)) return
      if (triggerRef?.current?.contains(target)) return
      onClose()
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    const onWindowMove = (): void => onClose()
    document.addEventListener('mousedown', onPointerDown, true)
    document.addEventListener('contextmenu', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    window.electron.ipcRenderer.on(IPC.WINDOW_MOVE, onWindowMove)
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true)
      document.removeEventListener('contextmenu', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
      window.electron.ipcRenderer.removeListener(IPC.WINDOW_MOVE, onWindowMove)
    }
  }, [onClose, triggerRef])

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (showCreate) {
        onCreateAndSelect(search.trim())
        onClose()
      } else if (filtered.length === 1) {
        onSelect(filtered[0].id)
        onClose()
      }
    }
  }

  return createPortal(
    <div
      ref={ref}
      className="fixed z-[110] w-56 rounded-lg border border-border bg-background shadow-lg shadow-black/20 flex flex-col overflow-hidden"
      style={{ left: position.left, top: position.top, bottom: position.bottom }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation() }}
      onWheel={(e) => e.stopPropagation()}
    >
      {/* 搜索栏 */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <Search className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={handleInputKeyDown}
          placeholder="搜索或创建画布…"
          className={clsx(
            'flex-1 text-sm bg-transparent outline-none placeholder:text-muted-foreground',
            'text-foreground'
          )}
        />
      </div>

      {/* 画布列表 */}
      <div className="overflow-y-auto max-h-64 py-1">
        {filtered.map((c) => (
          <button
            key={c.id}
            onClick={() => { onSelect(c.id); onClose() }}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-left text-foreground hover:bg-muted transition-colors"
          >
            <Presentation className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
            <span className="flex-1 truncate">{c.name}</span>
          </button>
        ))}

        {showCreate && (
          <button
            onClick={() => { onCreateAndSelect(search.trim()); onClose() }}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-left text-primary hover:bg-muted transition-colors"
          >
            <Plus className="w-4 h-4 flex-shrink-0" />
            <span className="flex-1 truncate">创建「{search.trim()}」</span>
          </button>
        )}

        {!showCreate && filtered.length === 0 && (
          <div className="px-3 py-3 text-xs text-muted-foreground text-center">
            还没有画布
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
