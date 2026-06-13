import { useEffect } from 'react'
import clsx from 'clsx'

export interface ConfirmDialogProps {
  title: string
  /** 主体描述，可以是字符串或 JSX（用来突出名字等） */
  message: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** 危险操作：确认按钮变红 */
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * 通用二次确认对话框 — 居中遮罩弹层。
 *
 * - Esc 取消、Enter 确认
 * - 点击遮罩取消
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = '确认',
  cancelLabel = '取消',
  danger = false,
  onConfirm,
  onCancel
}: ConfirmDialogProps): React.JSX.Element {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel()
      else if (e.key === 'Enter') onConfirm()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onCancel, onConfirm])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onMouseDown={(e) => {
        // 点击遮罩本身才关闭，避免点到内容也跟着关
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div className="w-[400px] max-w-[90vw] rounded-xl border border-border bg-background shadow-xl shadow-black/30">
        <div className="px-5 py-4 border-b border-border">
          <h3 className="text-base font-semibold">{title}</h3>
        </div>
        <div className="px-5 py-4 text-sm text-foreground/90">{message}</div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-border">
          <button
            onClick={onCancel}
            className="px-4 py-1.5 text-sm rounded-lg border border-border hover:bg-muted transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={clsx(
              'px-4 py-1.5 text-sm rounded-lg text-white transition-colors',
              danger
                ? 'bg-red-500 hover:bg-red-600'
                : 'bg-primary hover:bg-primary-hover'
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
