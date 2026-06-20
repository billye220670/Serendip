import { create } from 'zustand'
import type { ShakeParams } from '../lib/cameraShake'
import { useCameraShakeStore } from './cameraShake'
import { useDetailStore } from './detail'

/**
 * 沉浸锁定会话（一次进出锁定模式）的共享临时状态 —— **不持久化**。
 * 被 LockViewport / LockPinnedRail / LockShakeBar / DetailView 共用。
 */

export interface PanZoom {
  tx: number
  ty: number
  s: number
}
export interface ShakeSnap {
  enabled: boolean
  params: ShakeParams
  activePreset: string | null
}
export interface CellSnap {
  pan?: PanZoom
  shake?: ShakeSnap
}

/** 读取当前全局手摇为可还原的快照（params 浅拷贝） */
export function snapshotShake(): ShakeSnap {
  const s = useCameraShakeStore.getState()
  return { enabled: s.enabled, params: { ...s.params }, activePreset: s.activePreset }
}

/** 把快照写回全局手摇 store */
export function applyShakeSnapshot(snap: ShakeSnap | null): void {
  if (!snap) return
  useCameraShakeStore.setState({
    enabled: snap.enabled,
    params: { ...snap.params },
    activePreset: snap.activePreset
  })
}

/** order 内把 fromKey 移到 toKey 所在位置（arrayMove 等价） */
function moveKey(order: number[], fromKey: number, toKey: number): number[] {
  const from = order.indexOf(fromKey)
  const to = order.indexOf(toKey)
  if (from < 0 || to < 0 || from === to) return order
  const next = order.slice()
  next.splice(from, 1)
  next.splice(to, 0, fromKey)
  return next
}

interface LockSessionState {
  active: boolean
  /** 锁定格 key 的会话内显示顺序（重排只动这里，不影响外部底部缩略图条） */
  order: number[]
  /** key → 每图 pan/shake 记忆（仅内存） */
  snapshots: Record<number, CellSnap>
  autoplay: boolean
  /** 进会话前的全局手摇，退出时还原（避免每图临时状态泄漏进 persist） */
  _savedGlobalShake: ShakeSnap | null

  begin: (orderedKeys: number[]) => void
  end: () => void
  /** 同步新增/移除的锁定格（保持原相对顺序，安全兜底） */
  reconcile: (pinnedKeysInCellOrder: number[]) => void
  reorder: (fromKey: number, toKey: number) => void
  /** 用 order 循环切到上一/下一张锁定图（→ 改 detail.cursor） */
  cyclePinned: (dir: 1 | -1) => void
  /** 点击缩略图：切到该 key */
  goToKey: (key: number) => void
  saveSnapshot: (key: number, snap: CellSnap) => void
  toggleAutoplay: () => void
  setAutoplay: (v: boolean) => void
}

export const useLockSessionStore = create<LockSessionState>((set, get) => ({
  active: false,
  order: [],
  snapshots: {},
  autoplay: false,
  _savedGlobalShake: null,

  begin: (orderedKeys) => {
    set({
      active: true,
      order: orderedKeys,
      snapshots: {},
      autoplay: false,
      _savedGlobalShake: snapshotShake()
    })
  },

  end: () => {
    if (!get().active) return
    applyShakeSnapshot(get()._savedGlobalShake)
    set({ active: false, order: [], snapshots: {}, autoplay: false, _savedGlobalShake: null })
  },

  reconcile: (pinnedKeys) => {
    const cur = get().order
    const pinnedSet = new Set(pinnedKeys)
    // 保留仍锁定的（维持会话内顺序），再把新增的锁定格按 cells 顺序追加
    const kept = cur.filter((k) => pinnedSet.has(k))
    const keptSet = new Set(kept)
    const added = pinnedKeys.filter((k) => !keptSet.has(k))
    const next = [...kept, ...added]
    if (next.length === cur.length && next.every((k, i) => k === cur[i])) return
    set({ order: next })
  },

  reorder: (fromKey, toKey) => {
    set((s) => ({ order: moveKey(s.order, fromKey, toKey) }))
  },

  cyclePinned: (dir) => {
    const { order } = get()
    if (order.length === 0) return
    const { cells, cursor, jumpTo } = useDetailStore.getState()
    const curKey = cells[cursor]?.key
    const pos = curKey != null ? order.indexOf(curKey) : -1
    const targetKey =
      pos === -1
        ? dir === 1
          ? order[0]
          : order[order.length - 1]
        : order[(pos + dir + order.length) % order.length]
    const idx = cells.findIndex((c) => c.key === targetKey)
    if (idx >= 0) jumpTo(idx)
  },

  goToKey: (key) => {
    const { cells, jumpTo } = useDetailStore.getState()
    const idx = cells.findIndex((c) => c.key === key)
    if (idx >= 0) jumpTo(idx)
  },

  saveSnapshot: (key, snap) => {
    set((s) => ({ snapshots: { ...s.snapshots, [key]: snap } }))
  },

  toggleAutoplay: () => set((s) => ({ autoplay: !s.autoplay })),
  setAutoplay: (v) => set({ autoplay: v })
}))
