import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'

export interface ContextMenuItem {
  key: string
  /** 分隔线项 — 设为 true 时其它字段忽略 */
  divider?: boolean
  /** 分组标题（不可点击的灰色小标） */
  header?: boolean
  label?: string
  icon?: React.ElementType
  /** 危险操作（红色文字），如"不感兴趣" */
  danger?: boolean
  onClick?: () => void
}

export interface ContextMenuProps {
  /** 触发位置（鼠标坐标） */
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

/**
 * 浮动右键菜单。
 *
 * 行为：
 * - 点击菜单项后自动关闭
 * - 点击菜单外、按 Esc、滚动、窗口失焦都会关闭
 * - 自动避开屏幕右/下边界
 */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState<{ left: number; top: number }>({
    left: x,
    top: y
  })

  // 在 layout 阶段测量后调整位置，避开屏幕右下边缘
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const margin = 8
    let left = x
    let top = y
    if (left + rect.width + margin > window.innerWidth) {
      left = Math.max(margin, window.innerWidth - rect.width - margin)
    }
    if (top + rect.height + margin > window.innerHeight) {
      top = Math.max(margin, window.innerHeight - rect.height - margin)
    }
    setPosition({ left, top })
  }, [x, y])

  // 关闭事件：外部点击 / Esc / 滚动 / 窗口失焦
  useEffect(() => {
    const onPointerDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    const onScroll = (): void => onClose()
    const onBlur = (): void => onClose()

    // 用 capture 确保比 React onClick 先收到，避免菜单项点完又被外部点击关闭重复 onClose
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
          return (
            <div
              key={item.key}
              role="separator"
              className="my-1 mx-2 h-px bg-border"
            />
          )
        }
        if (item.header) {
          return (
            <div
              key={item.key}
              className="px-3 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              {item.label}
            </div>
          )
        }
        const Icon = item.icon
        return (
          <button
            key={item.key}
            role="menuitem"
            onClick={(e) => {
              e.stopPropagation()
              item.onClick?.()
              onClose()
            }}
            className={clsx(
              'w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-left transition-colors',
              item.danger
                ? 'text-red-500 hover:bg-red-500/10'
                : 'text-foreground hover:bg-muted'
            )}
          >
            {Icon && <Icon className="w-4 h-4 flex-shrink-0" />}
            <span className="flex-1 truncate">{item.label}</span>
          </button>
        )
      })}
    </div>,
    document.body
  )
}
