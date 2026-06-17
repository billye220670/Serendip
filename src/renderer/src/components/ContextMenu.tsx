import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight } from 'lucide-react'
import clsx from 'clsx'
import { IPC } from '../../../main/ipc/contract'

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
  /** hover 到非子菜单项时调用，用于关闭已展开的子面板 */
  onSubmenuClose?: () => void
}

export function ContextMenu({
  x,
  y,
  items,
  onClose,
  placement = 'cursor',
  onSubmenuClose
}: ContextMenuProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [position, setPosition] = useState<{ left: number; top: number }>({ left: x, top: y })

  const cancelHover = useCallback(() => {
    if (hoverTimer.current !== null) {
      clearTimeout(hoverTimer.current)
      hoverTimer.current = null
    }
  }, [])

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
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    const onScroll = (): void => onClose()
    const onBlur = (): void => onClose()
    const onWindowMove = (): void => onClose()

    document.addEventListener('mousedown', onPointerDown, true)
    document.addEventListener('contextmenu', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    window.electron.ipcRenderer.on(IPC.WINDOW_MOVE, onWindowMove)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('blur', onBlur)
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true)
      document.removeEventListener('contextmenu', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
      window.electron.ipcRenderer.removeListener(IPC.WINDOW_MOVE, onWindowMove)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={ref}
      role="menu"
      style={{ left: position.left, top: position.top }}
      className="fixed z-[200] min-w-[180px] py-1 rounded-lg border border-border bg-background shadow-lg shadow-black/20 animate-in"
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
                cancelHover()
                hoverTimer.current = setTimeout(() => {
                  item.onSubmenuOpen!(rect)
                }, 150)
              } else {
                cancelHover()
                onSubmenuClose?.()
              }
            }}
            onMouseLeave={() => {
              if (hasSubmenu) cancelHover()
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
