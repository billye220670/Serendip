import { create } from 'zustand'
import { createPortal } from 'react-dom'

interface ToastEntry {
  id: number
  canvasId: number
  canvasName: string
  count: number
  timerId: number
}

interface MessageEntry {
  id: number
  text: string
}

interface ToastState {
  toasts: ToastEntry[]
  messages: MessageEntry[]
  _nextId: number
  _nextMsgId: number
  push: (canvasId: number, canvasName: string, count: number) => void
  dismiss: (id: number) => void
  pushMessage: (text: string) => void
  dismissMessage: (id: number) => void
}

const TOAST_TTL = 2500
const MERGE_WINDOW = 1500

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  messages: [],
  _nextId: 1,
  _nextMsgId: 1,

  push: (canvasId: number, canvasName: string, count: number) => {
    const state = get()
    // 同一画布最近的 toast 还在 merge 窗口内则合并
    const existing = state.toasts.find((t) => t.canvasId === canvasId)
    if (existing) {
      clearTimeout(existing.timerId)
      const newTimer = window.setTimeout(() => get().dismiss(existing.id), TOAST_TTL)
      set((s) => ({
        toasts: s.toasts.map((t) =>
          t.id === existing.id
            ? { ...t, count: t.count + count, timerId: newTimer }
            : t
        )
      }))
      return
    }
    const id = state._nextId
    const timerId = window.setTimeout(() => get().dismiss(id), TOAST_TTL)
    set((s) => ({
      _nextId: s._nextId + 1,
      toasts: [
        ...s.toasts,
        { id, canvasId, canvasName, count, timerId }
      ]
    }))
  },

  dismiss: (id: number) => {
    set((s) => ({
      toasts: s.toasts.filter((t) => {
        if (t.id === id) {
          clearTimeout(t.timerId)
          return false
        }
        return true
      })
    }))
  },

  // 通用消息通道（插件成功/失败提示），复用相同 TTL
  pushMessage: (text: string) => {
    const id = get()._nextMsgId
    window.setTimeout(() => get().dismissMessage(id), TOAST_TTL)
    set((s) => ({
      _nextMsgId: s._nextMsgId + 1,
      messages: [...s.messages, { id, text }]
    }))
  },

  dismissMessage: (id: number) => {
    set((s) => ({
      messages: s.messages.filter((m) => m.id !== id)
    }))
  }
}))

// 方便外部调用的工厂函数
export function pushCanvasToast(canvasId: number, canvasName: string, count = 1): void {
  useToastStore.getState().push(canvasId, canvasName, count)
}

// 插件通用消息提示（成功/失败），不带“前往”按钮
export function pushPluginToast(text: string): void {
  useToastStore.getState().pushMessage(text)
}

// Toast 渲染组件（放在 App 根节点）
export function ToastContainer({
  onNavigate
}: {
  onNavigate: (canvasId: number) => void
}): React.JSX.Element {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)
  const messages = useToastStore((s) => s.messages)

  if (toasts.length === 0 && messages.length === 0) return <></>

  return createPortal(
    <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[300] flex flex-col items-center gap-2 pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="pointer-events-auto flex items-center gap-3 rounded-full border border-border bg-glass backdrop-blur-xl px-4 py-2 text-sm shadow-lg shadow-black/20 animate-in"
        >
          <span className="text-foreground">
            {toast.count > 1
              ? `已加入 ${toast.count} 张到「${toast.canvasName}」`
              : `已加入「${toast.canvasName}」`}
          </span>
          <button
            onClick={() => { dismiss(toast.id); onNavigate(toast.canvasId) }}
            className="text-primary hover:underline text-sm font-medium flex-shrink-0"
          >
            前往
          </button>
        </div>
      ))}
      {messages.map((message) => (
        <div
          key={`msg-${message.id}`}
          className="pointer-events-auto flex items-center gap-3 rounded-full border border-border bg-glass backdrop-blur-xl px-4 py-2 text-sm shadow-lg shadow-black/20 animate-in"
        >
          <span className="text-foreground">{message.text}</span>
        </div>
      ))}
    </div>,
    document.body
  )
}

// 使 merge 窗口正常关联（重置 merge 窗口计时器）
export { MERGE_WINDOW }
