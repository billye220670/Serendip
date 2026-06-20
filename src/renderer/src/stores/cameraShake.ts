import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_SHAKE_PARAMS, type ShakeParams } from '../lib/cameraShake'

interface CameraShakeState {
  /** 总开关（持久化）—— 底部工具栏摄影机按钮 toggle */
  enabled: boolean
  /** 当前参数（持久化） */
  params: ShakeParams
  /** 用户预设（持久化 localStorage），按插入顺序保留名称数组以便滚轮循环 */
  presets: Record<string, ShakeParams>
  presetOrder: string[]
  /** 当前选中的预设名（null=自定义/未选） */
  activePreset: string | null

  setParam: <K extends keyof ShakeParams>(key: K, value: ShakeParams[K]) => void
  setEnabled: (enabled: boolean) => void
  toggleEnabled: () => void
  /** 用当前参数新建预设并选中它；返回错误字符串表示失败（重名/空名） */
  createPreset: (name: string) => string | undefined
  /** 加载某预设的参数为当前参数并选中 */
  applyPreset: (name: string) => void
  deletePreset: (name: string) => void
  /** 在预设列表里按方向循环切换（滚轮用）；无预设时无操作 */
  cyclePreset: (dir: 1 | -1) => void
}

export const useCameraShakeStore = create<CameraShakeState>()(
  persist(
    (set, get) => ({
      enabled: false,
      params: { ...DEFAULT_SHAKE_PARAMS },
      presets: {},
      presetOrder: [],
      activePreset: null,

      // 改任意参数即视为「自定义」，脱离当前预设选中态
      setParam: (key, value) =>
        set((s) => ({ params: { ...s.params, [key]: value }, activePreset: null })),

      setEnabled: (enabled) => set({ enabled }),

      toggleEnabled: () => set((s) => ({ enabled: !s.enabled })),

      createPreset: (name) => {
        const trimmed = name.trim()
        if (!trimmed) return '请输入预设名称'
        if (get().presets[trimmed]) return '已存在同名预设'
        set((s) => ({
          presets: { ...s.presets, [trimmed]: { ...s.params } },
          presetOrder: [...s.presetOrder, trimmed],
          activePreset: trimmed
        }))
        return undefined
      },

      applyPreset: (name) =>
        set((s) => {
          const preset = s.presets[name]
          return preset ? { params: { ...preset }, activePreset: name } : {}
        }),

      deletePreset: (name) =>
        set((s) => {
          const next = { ...s.presets }
          delete next[name]
          return {
            presets: next,
            presetOrder: s.presetOrder.filter((n) => n !== name),
            activePreset: s.activePreset === name ? null : s.activePreset
          }
        }),

      cyclePreset: (dir) =>
        set((s) => {
          const order = s.presetOrder
          if (order.length === 0) return {}
          const curIdx = s.activePreset ? order.indexOf(s.activePreset) : -1
          const nextIdx = (curIdx + dir + order.length) % order.length
          const name = order[nextIdx]
          const preset = s.presets[name]
          return preset ? { params: { ...preset }, activePreset: name } : {}
        })
    }),
    {
      name: 'serendip-camera-shake',
      partialize: (s) => ({
        enabled: s.enabled,
        params: s.params,
        presets: s.presets,
        presetOrder: s.presetOrder,
        activePreset: s.activePreset
      })
    }
  )
)
