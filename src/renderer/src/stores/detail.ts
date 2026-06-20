import { create } from 'zustand'
import type { MediaItem, ExploreMode } from '../../../main/recommender'
import { useUIStore } from './ui'

const BUFFER_SIZE = 6
const FETCH_BATCH = 8
const PREFETCH_THRESHOLD = 2

/**
 * 接力队列里的一个位置。
 * key 与 media id 解耦（自增唯一），允许同一张图在小目录里重复出现，
 * 从而保证「无论目录里有几张图，往下滚都会新增缩略图」的一致心智。
 */
export interface SeqEntry {
  key: number
  item: MediaItem
}

let nextSeqKey = 1
function wrap(item: MediaItem): SeqEntry {
  return { key: nextSeqKey++, item }
}

interface DetailState {
  isOpen: boolean
  sequence: SeqEntry[]
  cursor: number
  /**
   * 已到达的最远位置（sequence 坐标）。缩略图窗口固定为 [maxCursor-BUFFER_SIZE+1 .. maxCursor]，
   * 回滚下界即窗口最左格 —— 到达后不能再往更早回退，只能往更新方向滚。
   */
  maxCursor: number
  /** 当前抽样路径范围；null = 使用全局 rootPath */
  scopePath: string | null
  /** 用户主动通过面包屑设置了 scope，此时严格限定范围不自动放宽 */
  scopeLocked: boolean
  fetching: boolean
  /** 一次性标志：下一次 _appendItems 后把游标跳到新追加的第一张（面包屑切 scope 用） */
  _jumpOnAppend: boolean

  open: (item: MediaItem) => void
  /** 在详情页内接力到指定图：保留历史、接到末尾、切到该图的目录范围 */
  relayTo: (item: MediaItem) => void
  close: () => void
  next: () => void
  prev: () => void
  jumpTo: (index: number) => void
  setScope: (path: string | null) => void
  /** 内部：追加推荐到队列（供 fetchAndAppend 调用） */
  _appendItems: (items: MediaItem[]) => void
  _setFetching: (v: boolean) => void
}

export const useDetailStore = create<DetailState>((set, get) => ({
  isOpen: false,
  sequence: [],
  cursor: 0,
  maxCursor: 0,
  scopePath: null,
  scopeLocked: false,
  fetching: false,
  _jumpOnAppend: false,

  _appendItems: (items) => {
    const state = get()
    // 裁剪头部：cursor 往前最多保留 BUFFER_SIZE 张，但只在 sequence 超出 2 倍阈值时才裁
    const shouldTrim = state.sequence.length > BUFFER_SIZE * 2
    const trimStart = shouldTrim ? Math.max(0, state.cursor - BUFFER_SIZE) : 0
    const trimmed = state.sequence.slice(trimStart)
    const wrapped = items.map(wrap)
    const newSeq = [...trimmed, ...wrapped]

    if (state._jumpOnAppend && wrapped.length > 0) {
      // 面包屑切 scope 后：自动定位到新 scope 抽出的第一张
      const firstNewIndex = trimmed.length
      set({
        sequence: newSeq,
        cursor: firstNewIndex,
        maxCursor: firstNewIndex,
        _jumpOnAppend: false,
        fetching: false,
      })
      // 再追一批 —— 推荐面板（d）需要的是 sequence[cursor+1..] 这段。
      // 仅这一轮追加里 cursor 之后通常只有 wrapped.length-1 张可推荐；
      // 小目录场景甚至只有 0~1 张，面板会撑大量骨架。补这一刀让推荐池立即填厚。
      void triggerPrefetch()
      return
    }

    const newCursor = state.cursor - trimStart
    set({
      sequence: newSeq,
      cursor: newCursor,
      maxCursor: Math.max(0, state.maxCursor - trimStart),
      fetching: false,
    })
  },

  _setFetching: (v) => set({ fetching: v }),

  open: (item) => {
    set({
      isOpen: true,
      sequence: [wrap(item)],
      cursor: 0,
      maxCursor: 0,
      scopePath: item.folder_path,
      scopeLocked: true,
      fetching: false,
      _jumpOnAppend: false,
    })
    void triggerPrefetch()
  },

  relayTo: (item) => {
    const state = get()
    // 接力到推荐图：保留已访问历史（0..maxCursor），丢弃旧 scope 未看的预取项，
    // 把目标图接到历史末尾并把游标落到它 —— 与 open 的「整段重置」不同，这样回滚仍能
    // 滚到接力前的历史，缩略图条上更早的项也仍可点击（key 都还在 sequence 里）。
    const kept = state.sequence.slice(0, state.maxCursor + 1)
    const wrapped = wrap(item)
    const newSeq = [...kept, wrapped]
    const newIndex = newSeq.length - 1
    set({
      sequence: newSeq,
      cursor: newIndex,
      maxCursor: newIndex,
      scopePath: item.folder_path,
      scopeLocked: true,
      fetching: false,
      _jumpOnAppend: false,
    })
    void triggerPrefetch()
  },

  close: () => set({ isOpen: false }),

  next: () => {
    const state = get()
    const newCursor = state.cursor + 1
    if (newCursor >= state.sequence.length) return
    set({ cursor: newCursor, maxCursor: Math.max(state.maxCursor, newCursor) })
    if (state.sequence.length - newCursor <= PREFETCH_THRESHOLD) {
      void triggerPrefetch()
    }
  },

  prev: () => {
    const state = get()
    // 回滚下界 = 缩略图窗口最左格；到达后不能再往更早回退
    const floor = Math.max(0, state.maxCursor - (BUFFER_SIZE - 1))
    if (state.cursor <= floor) return
    set({ cursor: state.cursor - 1 })
  },

  jumpTo: (index) => {
    const state = get()
    if (index < 0 || index >= state.sequence.length) return
    set({ cursor: index, maxCursor: Math.max(state.maxCursor, index) })
    if (state.sequence.length - index <= PREFETCH_THRESHOLD) {
      void triggerPrefetch()
    }
  },

  setScope: (path) => {
    const state = get()
    // 切换 scope 不清空历史：保留所有已访问项（0..maxCursor），
    // 只丢弃 maxCursor 之后尚未看到的旧 scope 预取项；新 scope 从下次 prefetch 起追加。
    // _jumpOnAppend：让那次追加完成后自动把游标跳到新 scope 的第一张。
    const kept = state.sequence.slice(0, state.maxCursor + 1)
    set({
      scopePath: path,
      scopeLocked: true,
      sequence: kept,
      fetching: false,
      _jumpOnAppend: true,
    })
    void triggerPrefetch()
  },
}))

/**
 * 异步预取一批推荐，去重后 append 到队列。
 * scopeLocked=true：严格限定 scopePath。窗口内候选都看过时（小目录已循环一圈），
 *   不清空历史，而是允许重复 append —— 保证缩略图条持续增长、滚动反馈始终一致。
 * scopeLocked=false：逐级放宽兜底（此路径已不会被触发，保留备用）。
 */
async function triggerPrefetch(): Promise<void> {
  const store = useDetailStore.getState()
  if (store.fetching) return
  store._setFetching(true)

  try {
    const state = useDetailStore.getState()
    const mode: ExploreMode = useUIStore.getState().exploreMode as ExploreMode
    const scope = state.scopePath ?? undefined

    if (state.scopeLocked) {
      const seenIds = new Set(state.sequence.map((e) => e.item.id))
      const candidates = await window.api.getRecommendations(FETCH_BATCH, mode, false, scope)
      let items = candidates.filter((m) => !seenIds.has(m.id))

      if (items.length === 0) {
        // 当前窗口内候选都看过 —— scope 较小，已循环一圈。
        // 允许重复 append（不清空历史），仅避免与最后一张紧邻重复。
        const lastId = state.sequence[state.sequence.length - 1]?.item.id
        items = candidates.filter((m) => m.id !== lastId)
        if (items.length === 0 && candidates.length > 0) {
          // 目录只有一张：补一批它的副本，让滚动持续有缩略图新增、减少预取频率
          items = Array.from({ length: FETCH_BATCH }, () => candidates[0])
        }
      }

      if (items.length === 0) {
        // 没抽到任何项：清掉一次性跳转标志，避免泄漏到后续正常预取
        useDetailStore.setState({ fetching: false, _jumpOnAppend: false })
        return
      }
      useDetailStore.getState()._appendItems(items)
    } else {
      // 逐级放宽（open 时 scopeLocked=true，此分支理论上不触发）
      const seenIds = new Set(state.sequence.map((e) => e.item.id))
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
      let items: MediaItem[] = []
      for (const s of scopesToTry) {
        const candidates = await window.api.getRecommendations(FETCH_BATCH, mode, false, s)
        items = candidates.filter((m) => !seenIds.has(m.id))
        if (items.length > 0) break
      }
      if (items.length === 0) {
        useDetailStore.getState()._setFetching(false)
        return
      }
      useDetailStore.getState()._appendItems(items)
    }
  } catch {
    useDetailStore.setState({ fetching: false, _jumpOnAppend: false })
  }
}

export { BUFFER_SIZE }

/**
 * 对外暴露：让推荐面板（d）触底时主动追加一批，不改 cursor。
 * 内部已对 fetching 做幂等保护，重复调用安全。
 */
export function prefetchMore(): Promise<void> {
  return triggerPrefetch()
}
