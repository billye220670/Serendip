import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface PluginsState {
  /** 各插件的启用状态（按插件 id 索引） */
  enabled: Record<string, boolean>
  setPluginEnabled: (id: string, enabled: boolean) => void
  /** P2V Bridge 目标端口 */
  p2vPort: number
  setP2VPort: (port: number) => void
}

export const usePluginsStore = create<PluginsState>()(
  persist(
    (set) => ({
      enabled: { p2vBridge: false },

      setPluginEnabled: (id, enabled) =>
        set((state) => ({ enabled: { ...state.enabled, [id]: enabled } })),

      p2vPort: 3000,
      setP2VPort: (port) => set({ p2vPort: port })
    }),
    {
      name: 'serendip-plugins'
    }
  )
)

/** 便捷 hook：pix2real 桥接插件是否启用 */
export const useP2VEnabled = (): boolean => usePluginsStore((s) => s.enabled.p2vBridge ?? false)

/** 便捷 hook：P2V Bridge 目标端口 */
export const useP2VPort = (): number => usePluginsStore((s) => s.p2vPort ?? 3000)
