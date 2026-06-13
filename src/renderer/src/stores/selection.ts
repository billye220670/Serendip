import { create } from 'zustand'
import { useCallback } from 'react'
import type { MediaItem } from '../../../main/recommender'

/** 点选修饰键 — 卡片透传给视图，视图据此决定切换 / 区间选择 */
export interface SelectMods {
  ctrlOrMeta: boolean
  shift: boolean
}

/**
 * 多选状态（阶段 5）— 不持久化，切换视图时清空。
 *
 * - `selected`：选中的 fileId 集合；每次变更都生成新的 Set 以触发订阅刷新
 * - `active`：是否处于多选模式（决定卡片是否常显复选框、是否拦截单击）
 * - `anchor`：最近一次点选的项，用于 Shift 区间选择的锚点
 *
 * 进入多选的三条路径（见 MediaCard / 视图 hook）：长按、Ctrl/Cmd 点击、Shift 点击。
 * 区间选择需要按视图内的顺序计算，所以由各视图负责，store 只提供 setRange。
 */
interface SelectionState {
  selected: Set<number>
  active: boolean
  anchor: number | null

  /** 进入多选并选中某项（长按触发） */
  enter: (id: number) => void
  /** 切换某项的选中状态，并把它设为锚点；保持多选模式开启 */
  toggle: (id: number) => void
  /** 把一批 id 并入选中集（Shift 区间），保持已选不动 */
  setRange: (ids: number[]) => void
  /** 全选：用给定 id 覆盖选中集 */
  selectAll: (ids: number[]) => void
  /** 仅清空选中集，保留多选模式（工具条"清空"） */
  deselectAll: () => void
  /** 退出多选并清空（工具条 ✕ / 离开视图） */
  clear: () => void
}

export const useSelectionStore = create<SelectionState>((set) => ({
  selected: new Set(),
  active: false,
  anchor: null,

  enter: (id) =>
    set((s) => {
      const next = new Set(s.selected)
      next.add(id)
      return { selected: next, active: true, anchor: id }
    }),

  toggle: (id) =>
    set((s) => {
      const next = new Set(s.selected)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { selected: next, active: true, anchor: id }
    }),

  setRange: (ids) =>
    set((s) => {
      const next = new Set(s.selected)
      for (const id of ids) next.add(id)
      return { selected: next, active: true, anchor: ids.length ? ids[ids.length - 1] : s.anchor }
    }),

  selectAll: (ids) =>
    set(() => ({
      selected: new Set(ids),
      active: true,
      anchor: ids.length ? ids[ids.length - 1] : null
    })),

  deselectAll: () => set({ selected: new Set(), anchor: null }),

  clear: () => set({ selected: new Set(), active: false, anchor: null })
}))

/**
 * 视图侧选择 hook — 把"区间计算需要按当前顺序"的逻辑收口在这里。
 *
 * `items` 是视图当前已加载的有序列表（探索 = 已抽样项，分类 = 全部项）。
 * 返回供工具条 / 卡片使用的派生状态与回调。
 */
export function useGridSelection(items: MediaItem[]): {
  selectedCount: number
  selectionActive: boolean
  handleSelectClick: (item: MediaItem, mods: SelectMods) => void
  handleLongPress: (item: MediaItem) => void
  handleSelectAll: () => void
  getSelectedIds: () => number[]
  deselectAll: () => void
  clear: () => void
} {
  const selectedCount = useSelectionStore((s) => s.selected.size)
  const selectionActive = useSelectionStore((s) => s.active)
  const toggle = useSelectionStore((s) => s.toggle)
  const enter = useSelectionStore((s) => s.enter)
  const setRange = useSelectionStore((s) => s.setRange)
  const selectAll = useSelectionStore((s) => s.selectAll)
  const deselectAll = useSelectionStore((s) => s.deselectAll)
  const clear = useSelectionStore((s) => s.clear)

  const handleSelectClick = useCallback(
    (item: MediaItem, mods: SelectMods) => {
      const anchor = useSelectionStore.getState().anchor
      // Shift + 已有锚点：在当前顺序里选锚点到目标之间的全部
      if (mods.shift && anchor != null) {
        const a = items.findIndex((i) => i.id === anchor)
        const b = items.findIndex((i) => i.id === item.id)
        if (a !== -1 && b !== -1) {
          const [lo, hi] = a < b ? [a, b] : [b, a]
          setRange(items.slice(lo, hi + 1).map((i) => i.id))
          return
        }
      }
      // 其余情况（多选模式下普通单击 / Ctrl·Cmd 单击）：切换
      toggle(item.id)
    },
    [items, toggle, setRange]
  )

  const handleLongPress = useCallback((item: MediaItem) => enter(item.id), [enter])
  const handleSelectAll = useCallback(
    () => selectAll(items.map((i) => i.id)),
    [items, selectAll]
  )
  const getSelectedIds = useCallback(() => [...useSelectionStore.getState().selected], [])

  return {
    selectedCount,
    selectionActive,
    handleSelectClick,
    handleLongPress,
    handleSelectAll,
    getSelectedIds,
    deselectAll,
    clear
  }
}
