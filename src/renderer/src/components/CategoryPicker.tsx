import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Search, Plus, Folder } from 'lucide-react'
import clsx from 'clsx'
import type { Category } from '../../../main/categories'
import { IPC } from '../../../main/ipc/contract'

export interface CategoryPickerProps {
  /** 锚点坐标：
   *  - placement='top'     → 按钮上沿中心
   *  - placement='submenu' → 菜单行 DOMRect 的 right / top
   *  - placement='cursor'  → 鼠标位置
   */
  x: number
  y: number
  /** submenu 模式下父菜单的左边 x（用于向左翻转时对齐） */
  parentLeft?: number
  placement?: 'top' | 'submenu' | 'cursor'
  categories: Category[]
  onSelect: (categoryId: number) => void
  onCreateAndSelect: (name: string) => void
  onClose: () => void
}

export function CategoryPicker({
  x,
  y,
  parentLeft,
  placement = 'top',
  categories,
  onSelect,
  onCreateAndSelect,
  onClose
}: CategoryPickerProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [search, setSearch] = useState('')
  const [position, setPosition] = useState<{ left: number; top: number }>({ left: x, top: y })

  const filtered = categories.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  )
  const showCreate = search.trim().length > 0 && filtered.length === 0

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const margin = 8
    let left: number
    let top: number

    if (placement === 'top') {
      left = x - rect.width / 2
      top = y - rect.height - margin
    } else if (placement === 'submenu') {
      // 优先向右展开紧贴父菜单，不够时向左（子菜单右边对齐父菜单左边）
      left = x
      if (left + rect.width + margin > window.innerWidth) {
        left = (parentLeft ?? x) - rect.width
      }
      // 垂直：从行顶部向下，若超出底部则上移
      top = y
      if (top + rect.height + margin > window.innerHeight) {
        top = Math.max(margin, window.innerHeight - rect.height - margin)
      }
    } else {
      left = x
      top = y + margin
    }

    if (left + rect.width + margin > window.innerWidth) left = window.innerWidth - rect.width - margin
    if (left < margin) left = margin
    if (top + rect.height + margin > window.innerHeight) top = Math.max(margin, window.innerHeight - rect.height - margin)
    if (top < margin) top = margin

    setPosition({ left, top })
    inputRef.current?.focus()
  }, [x, y, placement])

  useEffect(() => {
    const onPointerDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
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
  }, [onClose])

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (showCreate) {
        onCreateAndSelect(search.trim())
        onClose()
      } else if (filtered.length === 1) {
        // 单一匹配时 Enter 直接选中
        onSelect(filtered[0].id)
        onClose()
      }
    }
  }

  return createPortal(
    <div
      ref={ref}
      data-menu-submenu
      className="fixed z-[110] w-56 rounded-lg border border-border bg-background shadow-lg shadow-black/20 flex flex-col overflow-hidden"
      style={{ left: position.left, top: position.top }}
      onWheel={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
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
          placeholder="搜索或创建分类…"
          className={clsx(
            'flex-1 text-sm bg-transparent outline-none placeholder:text-muted-foreground',
            'text-foreground'
          )}
        />
      </div>

      {/* 分类列表 */}
      <div className="overflow-y-auto max-h-64 py-1">
        {filtered.map((c) => (
          <button
            key={c.id}
            onClick={() => { onSelect(c.id); onClose() }}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-left text-foreground hover:bg-muted transition-colors"
          >
            <Folder className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
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
            还没有分类
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
