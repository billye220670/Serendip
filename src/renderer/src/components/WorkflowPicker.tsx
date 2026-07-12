import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Wand2 } from 'lucide-react'
import { P2V_WORKFLOWS } from '../lib/p2vWorkflows'
import { IPC } from '../../../main/ipc/contract'

export interface WorkflowPickerProps {
  /** 锚点坐标：
   *  - placement='top'     → 按钮上沿中心
   *  - placement='submenu' → 菜单行 DOMRect 的 right / top
   */
  x: number
  y: number
  /** submenu 模式下父菜单的左边 x（用于向左翻转时对齐） */
  parentLeft?: number
  placement: 'submenu' | 'top'
  onSelect: (id: number) => void
  onClose: () => void
}

export function WorkflowPicker({
  x,
  y,
  parentLeft,
  placement = 'top',
  onSelect,
  onClose
}: WorkflowPickerProps): React.JSX.Element {
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
      // submenu：优先向右展开紧贴父菜单，不够时向左（子菜单右边对齐父菜单左边）
      left = x
      if (left + rect.width + margin > window.innerWidth) {
        left = (parentLeft ?? x) - rect.width
      }
      // 垂直：从行顶部向下，若超出底部则上移
      top = y
      if (top + rect.height + margin > window.innerHeight) {
        top = Math.max(margin, window.innerHeight - rect.height - margin)
      }
    }

    if (left + rect.width + margin > window.innerWidth)
      left = window.innerWidth - rect.width - margin
    if (left < margin) left = margin
    if (top + rect.height + margin > window.innerHeight)
      top = Math.max(margin, window.innerHeight - rect.height - margin)
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

  return createPortal(
    <div
      ref={ref}
      data-menu-submenu
      className="fixed z-[110] w-56 rounded-lg border border-border bg-background shadow-lg shadow-black/20 flex flex-col overflow-hidden"
      style={{ left: position.left, top: position.top }}
      onWheel={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* 工作流列表 */}
      <div className="overflow-y-auto max-h-64 py-1">
        {P2V_WORKFLOWS.map((w) => (
          <button
            key={w.id}
            onClick={(e) => {
              e.stopPropagation()
              onSelect(w.id)
              onClose()
            }}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-left text-foreground hover:bg-muted transition-colors"
          >
            <Wand2 className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
            <span className="flex-1 truncate">{w.name}</span>
          </button>
        ))}
      </div>
    </div>,
    document.body
  )
}
