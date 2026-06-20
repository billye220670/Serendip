import { create } from 'zustand'
import type { MediaItem, ExploreMode } from '../../../main/recommender'
import { useUIStore } from './ui'

const BUFFER_SIZE = 6
const FETCH_BATCH = 8
const PREFETCH_THRESHOLD = 2

/**
 * 缩略图条里的一格（也是导航单元）。
 * key 与 media id 解耦（自增唯一），允许同一张图在小目录里重复出现，
 * 并作为缩略图条 FLIP 动画的稳定身份。
 * pinned：是否锁定（钉住图位）—— 锁定格固定在原视觉槽位、接力时不被回收。
 */
export interface Cell {
  key: number
  item: MediaItem
  pinned: boolean
}

let nextSeqKey = 1
function makeCell(item: MediaItem, pinned = false): Cell {
  return { key: nextSeqKey++, item, pinned }
}

/**
 * 接力前进：把 newItem 带入可见窗口，返回新 cells 与新图落点 slot 下标。
 * - 未满（< BUFFER_SIZE）：直接追加到最右，无人离场。
 * - 已满：回收「最左的未锁定格」，未锁定流左移并绕过锁定格；新图入「最右未锁定槽」。
 * - 全锁定（无未锁定格可回收）：返回 null 表示 BLOCKED —— 不接力。
 *
 * 关键：锁定格 slot 保持不变 → 动画零位移（停在原位）；未锁定格 slot 改变 → 左移越过锁定格。
 */
function relayForward(
  cells: Cell[],
  newItem: MediaItem
): { cells: Cell[]; placedIndex: number } | null {
  if (cells.length < BUFFER_SIZE) {
    const newCell = makeCell(newItem)
    return { cells: [...cells, newCell], placedIndex: cells.length }
  }
  // 已满：需要一个未锁定格让位
  if (!cells.some((c) => !c.pinned)) return null
  const newCell = makeCell(newItem)
  const unlocked = cells.filter((c) => !c.pinned) // 视觉顺序
  const queue = [...unlocked.slice(1), newCell] // 丢最左未锁定，新图入队尾
  const result: Cell[] = new Array(cells.length)
  let qi = 0
  let placedIndex = -1
  for (let slot = 0; slot < cells.length; slot++) {
    if (cells[slot].pinned) {
      result[slot] = cells[slot] // 锁定格原位不动
    } else {
      result[slot] = queue[qi]
      if (queue[qi] === newCell) placedIndex = slot
      qi++
    }
  }
  return { cells: result, placedIndex }
}

interface DetailState {
  isOpen: boolean
  /** 可见缩略图条，视觉左→右 = index 0..n-1，长度 ≤ BUFFER_SIZE。也是导航单元。 */
  cells: Cell[]
  /** 指向 cells 的下标（当前大图 = cells[cursor]）。前沿 = cells.length-1；回滚下界 = 0。 */
  cursor: number
  /** 预取的「接力储备」，接力前进时从队首取。 */
  pool: MediaItem[]
  /** 当前抽样路径范围；null = 使用全局 rootPath */
  scopePath: string | null
  /** 用户主动通过面包屑设置了 scope，此时严格限定范围不自动放宽 */
  scopeLocked: boolean
  fetching: boolean
  /** 一次性标志：切 scope 后，待预取回来自动接力前进一张到新 scope（替代旧 _jumpOnAppend） */
  _pendingScopeJump: boolean

  open: (item: MediaItem) => void
  /** 在详情页内接力到指定图（推荐面板选图）：保留历史 + 锁定格、接到末尾、切到该图的目录范围 */
  relayTo: (item: MediaItem) => void
  close: () => void
  next: () => void
  prev: () => void
  jumpTo: (index: number) => void
  /** 锁定/解锁某格（双击缩略图） */
  togglePin: (key: number) => void
  setScope: (path: string | null) => void
  _setFetching: (v: boolean) => void
}

export const useDetailStore = create<DetailState>((set, get) => ({
  isOpen: false,
  cells: [],
  cursor: 0,
  pool: [],
  scopePath: null,
  scopeLocked: false,
  fetching: false,
  _pendingScopeJump: false,

  open: (item) => {
    set({
      isOpen: true,
      cells: [makeCell(item)],
      cursor: 0,
      pool: [],
      scopePath: item.folder_path,
      scopeLocked: true,
      fetching: false,
      _pendingScopeJump: false,
    })
    void triggerPrefetch()
  },

  relayTo: (item) => {
    const state = get()
    // 选推荐接力：把选中图作为新当前带入（保留历史 + 锁定格），并切到该图目录范围。
    // 全锁定无空闲格 → 无法落位，整体不动（用户对锁定行为负责）。
    const res = relayForward(state.cells, item)
    if (!res) return
    set({
      cells: res.cells,
      cursor: res.placedIndex,
      pool: [],
      scopePath: item.folder_path,
      scopeLocked: true,
      fetching: false,
      _pendingScopeJump: false,
    })
    void triggerPrefetch()
  },

  close: () => set({ isOpen: false }),

  next: () => {
    const state = get()
    // 窗口内右移（可能落到锁定/未锁定格）
    if (state.cursor < state.cells.length - 1) {
      set({ cursor: state.cursor + 1 })
      return
    }
    // 在前沿：接力前进
    if (state.pool.length === 0) {
      void triggerPrefetch()
      return
    }
    const res = relayForward(state.cells, state.pool[0])
    if (!res) return // 全锁定 → 不接力（pool 不动）
    set({ cells: res.cells, cursor: res.placedIndex, pool: state.pool.slice(1) })
    if (state.pool.length - 1 <= PREFETCH_THRESHOLD) void triggerPrefetch()
  },

  prev: () => {
    const state = get()
    if (state.cursor <= 0) return
    set({ cursor: state.cursor - 1 })
  },

  jumpTo: (index) => {
    const state = get()
    if (index < 0 || index >= state.cells.length) return
    set({ cursor: index })
  },

  togglePin: (key) => {
    set((state) => ({
      cells: state.cells.map((c) => (c.key === key ? { ...c, pinned: !c.pinned } : c)),
    }))
  },

  setScope: (path) => {
    // 切 scope：保留历史 cells（含锁定格），清旧 scope 储备，
    // 预取回来后由 _pendingScopeJump 自动接力前进一张到新 scope。
    set({
      scopePath: path,
      scopeLocked: true,
      pool: [],
      fetching: false,
      _pendingScopeJump: true,
    })
    void triggerPrefetch()
  },

  _setFetching: (v) => set({ fetching: v }),
}))

/**
 * 异步预取一批推荐，去重后追加到 pool。
 * scopeLocked=true：严格限定 scopePath。窗口内候选都看过时（小目录已循环一圈），
 *   允许重复 append（不清空历史），保证滚动反馈始终一致。
 * scopeLocked=false：逐级放宽兜底（open 时即 locked，此路径已不会被触发，保留备用）。
 */
async function triggerPrefetch(): Promise<void> {
  const store = useDetailStore.getState()
  if (store.fetching) return
  store._setFetching(true)

  try {
    const state = useDetailStore.getState()
    const mode: ExploreMode = useUIStore.getState().exploreMode as ExploreMode
    const scope = state.scopePath ?? undefined
    const seenIds = new Set<number>([
      ...state.cells.map((c) => c.item.id),
      ...state.pool.map((m) => m.id),
    ])

    let items: MediaItem[] = []

    if (state.scopeLocked) {
      const candidates = await window.api.getRecommendations(FETCH_BATCH, mode, false, scope)
      items = candidates.filter((m) => !seenIds.has(m.id))

      if (items.length === 0) {
        // 当前已见候选都看过 —— scope 较小，已循环一圈。允许重复（仅避免与队尾紧邻重复）。
        const lastId =
          state.pool.length > 0
            ? state.pool[state.pool.length - 1].id
            : state.cells[state.cells.length - 1]?.item.id
        items = candidates.filter((m) => m.id !== lastId)
        if (items.length === 0 && candidates.length > 0) {
          // 目录只有一张：补一批它的副本，让滚动持续有缩略图新增、减少预取频率
          items = Array.from({ length: FETCH_BATCH }, () => candidates[0])
        }
      }
    } else {
      // 逐级放宽（理论上不触发，保留备用）
      const scopesToTry: Array<string | undefined> = [scope]
      if (state.scopePath) {
        const normalized = state.scopePath.replace(/\\/g, '/')
        const parts = normalized.split('/').filter(Boolean)
        if (parts.length > 1) {
          parts.pop()
          const parent = (state.scopePath.startsWith('\\\\') ? '\\\\' : '') + parts.join('\\')
          scopesToTry.push(parent)
        }
        scopesToTry.push(undefined)
      }
      for (const s of scopesToTry) {
        const candidates = await window.api.getRecommendations(FETCH_BATCH, mode, false, s)
        items = candidates.filter((m) => !seenIds.has(m.id))
        if (items.length > 0) break
      }
    }

    if (items.length === 0) {
      useDetailStore.setState({ fetching: false, _pendingScopeJump: false })
      return
    }

    useDetailStore.setState((s) => ({ pool: [...s.pool, ...items], fetching: false }))

    // 切 scope 后：自动接力前进一张，把新 scope 的第一张作为当前（保留历史 + 锁定格）
    const after = useDetailStore.getState()
    if (after._pendingScopeJump && after.pool.length > 0) {
      const res = relayForward(after.cells, after.pool[0])
      if (res) {
        useDetailStore.setState({
          cells: res.cells,
          cursor: res.placedIndex,
          pool: after.pool.slice(1),
          _pendingScopeJump: false,
        })
      } else {
        // 全锁定无法带入新 scope 图 → 停在原位
        useDetailStore.setState({ _pendingScopeJump: false })
      }
    }
  } catch {
    useDetailStore.setState({ fetching: false, _pendingScopeJump: false })
  }
}

export { BUFFER_SIZE }

/**
 * 对外暴露：让推荐面板触底时主动追加一批，不改 cursor。
 * 内部已对 fetching 做幂等保护，重复调用安全。
 */
export function prefetchMore(): Promise<void> {
  return triggerPrefetch()
}
