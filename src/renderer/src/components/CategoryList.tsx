import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Folder, Pencil, Trash2 } from 'lucide-react'
import clsx from 'clsx'
import type { Category } from '../../../main/categories'
import { useLibraryStore } from '../stores/library'
import { useCategoriesStore } from '../stores/categories'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'

interface CategoryListProps {
  /** 当前正在拖拽的对象类型；当媒体被拖到分类时高亮该分类 */
  activeDragType: 'category' | 'media' | null
  /** 拖到的分类 id（用于高亮投放目标） */
  hoveredDropCategoryId: number | null
  /** 侧栏是否折叠（icon-only 模式） */
  collapsed?: boolean
  onRename: (cat: Category) => void
  onDelete: (cat: Category) => void
}

interface MenuState {
  x: number
  y: number
  category: Category
}

/**
 * 侧栏分类列表 — 可重排（拖拽）+ 可作为媒体投放目标。
 *
 * 关键点：
 * - DndContext 由 App 提供，本组件只挂 SortableContext
 * - 每行只用 useSortable，把"分类拖排序"和"媒体拖入"共用同一个 droppable id
 *   （cat-{id}）；区分由 App 的 onDragEnd 根据 active.data.type 完成
 */
export function CategoryList({
  activeDragType,
  hoveredDropCategoryId,
  collapsed,
  onRename,
  onDelete
}: CategoryListProps): React.JSX.Element {
  const categories = useCategoriesStore((s) => s.categories)
  const [menu, setMenu] = useState<MenuState | null>(null)

  const sortableIds = categories.map((c) => `cat-${c.id}`)

  const menuItems: ContextMenuItem[] = menu
    ? [
        {
          key: 'rename',
          label: '重命名',
          icon: Pencil,
          onClick: () => onRename(menu.category)
        },
        {
          key: 'delete',
          label: '删除分类',
          icon: Trash2,
          danger: true,
          onClick: () => onDelete(menu.category)
        }
      ]
    : []

  if (categories.length === 0) {
    return (
      <div className={clsx('py-3 text-xs text-muted-foreground italic', collapsed ? 'px-2 text-center' : 'px-5')}>
        {collapsed ? '…' : '还没有分类，点 + 新建一个'}
      </div>
    )
  }

  return (
    <>
      <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
        <div className="space-y-0.5">
          {categories.map((cat) => (
            <CategoryRow
              key={cat.id}
              category={cat}
              collapsed={collapsed}
              isMediaHover={
                activeDragType === 'media' && hoveredDropCategoryId === cat.id
              }
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({ x: e.clientX, y: e.clientY, category: cat })
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

interface CategoryRowProps {
  category: Category
  collapsed?: boolean
  isMediaHover: boolean
  onContextMenu: (e: React.MouseEvent) => void
}

function CategoryRow({
  category,
  collapsed,
  isMediaHover,
  onContextMenu
}: CategoryRowProps): React.JSX.Element {
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
    id: `cat-${category.id}`,
    data: { type: 'category', categoryId: category.id, name: category.name }
  })

  const isActive = view.kind === 'category' && view.id === category.id

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
        onClick={() => setView({ kind: 'category', id: category.id })}
        onContextMenu={onContextMenu}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={() => setShowTooltip(false)}
        className={clsx(
          'group flex items-center gap-2.5 py-3 text-sm cursor-pointer transition-colors',
          collapsed ? 'justify-center px-0' : 'px-5',
          isActive && 'text-primary',
          !isActive && !isMediaHover && 'text-foreground hover:bg-muted',
          isMediaHover && 'ring-2 ring-primary ring-inset bg-primary/15'
        )}
      >
        <Folder
          className={clsx(
            'w-4 h-4 flex-shrink-0',
            isActive ? 'text-primary' : 'text-muted-foreground'
          )}
        />
        {!collapsed && (
          <>
            <span className="flex-1 truncate">{category.name}</span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {category.itemCount}
            </span>
          </>
        )}
      </div>

      {/* 折叠态 tooltip — portal 到 body */}
      {collapsed && showTooltip && createPortal(
        <div
          className="fixed z-[200] pointer-events-none"
          style={{ left: 78, top: tooltipY }}
        >
          <div className="bg-glass backdrop-blur-xl border border-border text-foreground text-xs px-2.5 py-1.5 rounded-lg shadow-lg whitespace-nowrap flex items-center gap-2">
            <span>{category.name}</span>
            <span className="text-muted-foreground tabular-nums">{category.itemCount}</span>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
