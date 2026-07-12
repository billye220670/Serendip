import { useCallback, useState, type ReactNode } from 'react'
import { Send } from 'lucide-react'
import type { ContextMenuItem } from '../components/ContextMenu'
import { WorkflowPicker } from '../components/WorkflowPicker'
import { pushPluginToast } from '../components/Toast'
import { useP2VEnabled, useP2VPort } from '../stores/plugins'
import { P2V_WORKFLOWS } from '../lib/p2vWorkflows'

/** 兼容不同视图的媒体项：取 fileId 时优先 fileId，其次 id */
type MediaLike = { id?: number; fileId?: number }

interface P2VPickerState {
  x: number
  y: number
  parentLeft: number
  item: MediaLike
}

export interface UseP2VMenu {
  /** 拼进视图 menuItems 最前面；未启用插件时返回 [] */
  buildP2VItems: (item: MediaLike) => ContextMenuItem[]
  /** P2V 工作流子面板；在渲染 ContextMenu 的相邻位置渲染 */
  p2vPickerNode: ReactNode
  /** 关闭 P2V 子面板（在 closeMenu / onSubmenuClose 里一并调用） */
  closeP2VPicker: () => void
}

function getFileId(item: MediaLike): number | undefined {
  return item.fileId ?? item.id
}

export function useP2VMenu(): UseP2VMenu {
  const enabled = useP2VEnabled()
  const port = useP2VPort()
  const [p2vPicker, setP2vPicker] = useState<P2VPickerState | null>(null)

  const closeP2VPicker = useCallback(() => setP2vPicker(null), [])

  const buildP2VItems = useCallback(
    (item: MediaLike): ContextMenuItem[] => {
      if (!enabled) return []
      return [
        { key: 'p2v-header', header: true, label: 'P2V Bridge' },
        {
          key: 'p2v-send',
          label: '发送到工作流',
          icon: Send,
          submenuOpen: !!p2vPicker,
          onSubmenuOpen: (rect: DOMRect) =>
            setP2vPicker({ x: rect.right, y: rect.top, parentLeft: rect.left, item })
        },
        { key: 'p2v-divider', divider: true }
      ]
    },
    [enabled, p2vPicker]
  )

  const p2vPickerNode: ReactNode = p2vPicker ? (
    <WorkflowPicker
      placement="submenu"
      x={p2vPicker.x}
      y={p2vPicker.y}
      parentLeft={p2vPicker.parentLeft}
      onSelect={async (wf) => {
        const it = p2vPicker.item
        closeP2VPicker()
        const fileId = getFileId(it)
        if (fileId == null) {
          console.warn('[P2V-renderer] fileId is null, item:', it)
          return
        }
        const name = P2V_WORKFLOWS.find((w) => w.id === wf)?.name
        console.log('[P2V-renderer] sending via IPC', { fileId, wf, port, name })
        try {
          const r = await window.api.pluginP2VPush([fileId], wf, port)
          console.log('[P2V-renderer] IPC returned', r)
          pushPluginToast(r.error ? r.error : `已发送到 P2V · ${name}`)
        } catch (err) {
          console.error('[P2V-renderer] pluginP2VPush failed:', err)
          pushPluginToast('发送到 P2V 失败，请稍后重试')
        }
      }}
      onClose={closeP2VPicker}
    />
  ) : null

  return { buildP2VItems, p2vPickerNode, closeP2VPicker }
}

export default useP2VMenu
