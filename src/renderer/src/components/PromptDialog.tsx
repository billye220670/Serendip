import { useEffect, useRef, useState } from 'react'

export interface PromptDialogProps {
  title: string
  /** 输入框上方的描述行 */
  hint?: string
  initialValue?: string
  placeholder?: string
  confirmLabel?: string
  cancelLabel?: string
  /** 返回字符串错误时表示校验失败，弹窗内显示错误并阻止关闭 */
  onConfirm: (value: string) => void | string | Promise<void | string>
  onCancel: () => void
}

/**
 * 单行输入对话框 — 用于新建 / 重命名分类。
 *
 * - 自动聚焦并选中已有内容
 * - Esc 取消、Enter 确认
 * - onConfirm 可返回错误字符串以同步显示校验提示，或 throw 异步错误
 */
export function PromptDialog({
  title,
  hint,
  initialValue = '',
  placeholder,
  confirmLabel = '确认',
  cancelLabel = '取消',
  onConfirm,
  onCancel
}: PromptDialogProps): React.JSX.Element {
  const [value, setValue] = useState(initialValue)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const submit = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      const result = await onConfirm(value)
      if (typeof result === 'string') {
        setError(result)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div className="w-[420px] max-w-[90vw] rounded-xl border border-border bg-background shadow-xl shadow-black/30">
        <div className="px-5 py-4 border-b border-border">
          <h3 className="text-base font-semibold">{title}</h3>
        </div>
        <div className="px-5 py-4 space-y-2">
          {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
          <input
            ref={inputRef}
            type="text"
            value={value}
            placeholder={placeholder}
            onChange={(e) => {
              setValue(e.target.value)
              if (error) setError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void submit()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                onCancel()
              }
            }}
            className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background outline-none focus:border-primary transition-colors"
            maxLength={60}
          />
          {error && <div className="text-xs text-red-500">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-border">
          <button
            onClick={onCancel}
            className="px-4 py-1.5 text-sm rounded-lg border border-border hover:bg-muted transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={() => void submit()}
            disabled={busy || !value.trim()}
            className="px-4 py-1.5 text-sm rounded-lg bg-primary text-white hover:bg-primary-hover transition-colors disabled:opacity-50"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
