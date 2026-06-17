import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight } from 'lucide-react'
import clsx from 'clsx'

export interface ContextMenuItem {
  key: string
  divider?: boolean
  header?: boolean
  label?: string
  icon?: React.ElementType
  danger?: boolean
  onClick?: () => void
  /** hover 时在右侧展开子面板；传入菜单行自身的 DOMRect 作锚点 */
  onSubmenuOpen?: (rect: DOMRect) => void
  /** 子面板已打开时为 true（控制高亮状态） */
  submenuOpen?: boolean
}

export interface ContextMenuProps {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
  placement?: 'cursor' | 'top'
}

/** 判断事件目标是否落在标题栏拖拽区域（非 no-drag 子元素）。
 *  沿 DOM 向上走：遇到 no-drag 立即返回 false；遇到 data-drag-region 或 drag 返回 true。 */
function isOnDragRegion(target: EventTarget | null): boolean {
  let el = target as HTMLElement | null
  while (el && el !== document.body) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = el.style.getPropertyValue('-webkit-app-region') || (el.style as any).WebkitAppRegion || ''
    if (r === 'no-drag') return false
    if (r === 'drag') return true
    if (el.dataset.dragRegion === 'true') return true
    el = el.parentElement
  }
  return false
}

export function ContextMenu({
  x,
  y,
  items,
  onClose,
  placement = 'cursor'
}: ContextMenuProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState<{ left: number; top: number }>({ left: x, top: y })

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
    } else {
      left = x
      top = y
      if (top + rect.height + margin > window.innerHeight) {
        top = Math.max(margin, window.innerHeight - rect.height - margin)
      }
    }
    if (left + rect.width + margin > window.innerWidth) left = window.innerWidth - rect.width - margin
    if (left < margin) left = margin
    if (top < margin) top = margin
    setPosition({ left, top })
  }, [x, y, placement])

  useEffect(() => {
    const onPointerDown = (e: MouseEvent): void => {
      // 点击拖拽区域时关闭（用户按下标题栏准备拖动窗口）
      if (isOnDragRegion(e.target)) { onClose(); return }
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    const onScroll = (): void => onClose()
    const onBlur = (): void => onClose()

    document.addEventListener('mousedown', onPointerDown, true)
    document.addEventListener('contextmenu', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('blur', onBlur)
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true)
      document.removeEventListener('contextmenu', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={ref}
      role="menu"
      style={{ left: position.left, top: position.top }}
      className="fixed z-[100] min-w-[180px] py-1 rounded-lg border border-border bg-background shadow-lg shadow-black/20 animate-in"
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item) => {
        if (item.divider) {
          return <div key={item.key} role="separator" className="my-1 mx-2 h-px bg-border" />
        }
        if (item.header) {
          return (
            <div key={item.key} className="px-3 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {item.label}
            </div>
          )
        }
        const Icon = item.icon
        const hasSubmenu = !!item.onSubmenuOpen
        return (
          <button
            key={item.key}
            role="menuitem"
            onMouseEnter={(e) => {
              if (hasSubmenu) {
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                item.onSubmenuOpen!(rect)
              }
            }}
            onClick={(e) => {
              e.stopPropagation()
              if (!hasSubmenu) {
                item.onClick?.()
                onClose()
              }
            }}
            className={clsx(
              'w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-left transition-colors',
              item.danger
                ? 'text-red-500 hover:bg-red-500/10'
                : 'text-foreground hover:bg-muted',
              // 子面板已打开时保持高亮
              item.submenuOpen && !item.danger && 'bg-muted'
            )}
          >
            {Icon && <Icon className="w-4 h-4 flex-shrink-0" />}
            <span className="flex-1 truncate">{item.label}</span>
            {hasSubmenu && <ChevronRight className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground" />}
          </button>
        )
      })}
    </div>,
    document.body
  )
}
