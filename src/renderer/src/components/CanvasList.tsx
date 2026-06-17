import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Presentation, Pencil, Trash2 } from "lucide-react"
import clsx from 'clsx'
import type { Canvas } from '../../../main/canvases'
import { useLibraryStore } from '../stores/library'
import { useCanvasesStore } from '../stores/canvases'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'

interface CanvasListProps {
  activeDragType: 'category' | 'media' | 'canvas' | null
  hoveredDropCanvasId: number | null
  collapsed?: boolean
  onRename: (canvas: Canvas) => void
  onDelete: (canvas: Canvas) => void
}

interface MenuState {
  x: number
  y: number
  canvas: Canvas
}

export function CanvasList({
  activeDragType,
  hoveredDropCanvasId,
  collapsed,
  onRename,
  onDelete
}: CanvasListProps): React.JSX.Element {
  const canvases = useCanvasesStore((s) => s.canvases)
  const [menu, setMenu] = useState<MenuState | null>(null)

  const sortableIds = canvases.map((c) => `canvas-${c.id}`)

  const menuItems: ContextMenuItem[] = menu
    ? [
        {
          key: 'rename',
          label: '重命名',
          icon: Pencil,
          onClick: () => onRename(menu.canvas)
        },
        {
          key: 'delete',
          label: '删除画布',
          icon: Trash2,
          danger: true,
          onClick: () => onDelete(menu.canvas)
        }
      ]
    : []

  if (canvases.length === 0) {
    return (
      <div className={clsx('py-3 text-xs text-muted-foreground italic', collapsed ? 'px-2 text-center' : 'px-5')}>
        {collapsed ? '…' : '还没有画布，点 + 新建一个'}
      </div>
    )
  }

  return (
    <>
      <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
        <div className="space-y-0.5">
          {canvases.map((canvas) => (
            <CanvasRow
              key={canvas.id}
              canvas={canvas}
              collapsed={collapsed}
              isMediaHover={
                activeDragType === 'media' && hoveredDropCanvasId === canvas.id
              }
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({ x: e.clientX, y: e.clientY, canvas })
              }}
            />
          ))}
        </div>
      </SortableContext>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  )
}

interface CanvasRowProps {
  canvas: Canvas
  collapsed?: boolean
  isMediaHover: boolean
  onContextMenu: (e: React.MouseEvent) => void
}

function CanvasRow({
  canvas,
  collapsed,
  isMediaHover,
  onContextMenu
}: CanvasRowProps): React.JSX.Element {
  const view = useLibraryStore((s) => s.view)
  const setView = useLibraryStore((s) => s.setView)
  const [showTooltip, setShowTooltip] = useState(false)
  const [tooltipY, setTooltipY] = useState(0)
  const btnRef = useRef<HTMLDivElement>(null)

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({
    id: `canvas-${canvas.id}`,
    data: { type: 'canvas', canvasId: canvas.id, name: canvas.name }
  })

  const isActive = view.kind === 'canvas' && view.id === canvas.id

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1
  }

  const handleMouseEnter = (): void => {
    if (!collapsed) return
    const rect = btnRef.current?.getBoundingClientRect()
    if (rect) setTooltipY(rect.top)
    setShowTooltip(true)
  }

  return (
    <div className="relative">
      <div
        ref={(el) => {
          setNodeRef(el)
          ;(btnRef as React.MutableRefObject<HTMLDivElement | null>).current = el
        }}
        style={style}
        {...attributes}
        {...listeners}
        onClick={() => setView({ kind: 'canvas', id: canvas.id })}
        onContextMenu={onContextMenu}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={() => setShowTooltip(false)}
        className={clsx(
          'group flex items-center gap-2.5 py-3 text-sm cursor-pointer transition-colors',
          collapsed ? 'justify-center px-0' : 'px-5',
          isActive && 'text-primary',
          !isActive && !isMediaHover && 'text-foreground hover:bg-sidebar-hover',
          isMediaHover && 'ring-2 ring-primary ring-inset bg-primary/15'
        )}
      >
        <Presentation
          className={clsx(
            'w-4 h-4 flex-shrink-0',
            isActive ? 'text-primary' : 'text-muted-foreground'
          )}
        />
        {!collapsed && (
          <>
            <span className="flex-1 truncate">{canvas.name}</span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {canvas.itemCount}
            </span>
          </>
        )}
      </div>

      {collapsed && showTooltip && createPortal(
        <div
          className="fixed z-[200] pointer-events-none"
          style={{ left: 78, top: tooltipY }}
        >
          <div className="bg-sidebar border border-border text-foreground text-xs px-2.5 py-1.5 rounded-lg shadow-lg whitespace-nowrap flex items-center gap-2">
            <span>{canvas.name}</span>
            <span className="text-muted-foreground tabular-nums">{canvas.itemCount}</span>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
