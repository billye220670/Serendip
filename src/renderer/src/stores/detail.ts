import { create } from 'zustand'
import type { MediaItem, ExploreMode } from '../../../main/recommender'
import { useUIStore } from './ui'

const BUFFER_SIZE = 6
const FETCH_BATCH = 8
const PREFETCH_THRESHOLD = 2

interface DetailState {
  isOpen: boolean
  sequence: MediaItem[]
  cursor: number
  /** 当前抽样路径范围；null = 使用全局 rootPath */
  scopePath: string | null
  fetching: boolean

  open: (item: MediaItem) => void
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
  scopePath: null,
  fetching: false,

  _appendItems: (items) => {
    const state = get()
    // 裁剪头部：cursor 往前最多保留 BUFFER_SIZE 张，但只在 sequence 超出 2 倍阈值时才裁
    const shouldTrim = state.sequence.length > BUFFER_SIZE * 2
    const trimStart = shouldTrim ? Math.max(0, state.cursor - BUFFER_SIZE) : 0
    const trimmed = state.sequence.slice(trimStart)
    const newCursor = state.cursor - trimStart
    set({ sequence: [...trimmed, ...items], cursor: newCursor, fetching: false })
  },

  _setFetching: (v) => set({ fetching: v }),

  open: (item) => {
    set({
      isOpen: true,
      sequence: [item],
      cursor: 0,
      scopePath: item.folder_path,
      fetching: false,
    })
    void triggerPrefetch()
  },

  close: () => set({ isOpen: false }),

  next: () => {
    const state = get()
    const newCursor = state.cursor + 1
    if (newCursor >= state.sequence.length) return
    set({ cursor: newCursor })
    if (state.sequence.length - newCursor <= PREFETCH_THRESHOLD) {
      void triggerPrefetch()
    }
  },

  prev: () => {
    const state = get()
    if (state.cursor <= 0) return
    set({ cursor: state.cursor - 1 })
  },

  jumpTo: (index) => {
    const state = get()
    if (index < 0 || index >= state.sequence.length) return
    set({ cursor: index })
    if (state.sequence.length - index <= PREFETCH_THRESHOLD) {
      void triggerPrefetch()
    }
  },

  setScope: (path) => {
    const state = get()
    const current = state.sequence[state.cursor]
    set({
      scopePath: path,
      sequence: current ? [current] : [],
      cursor: 0,
      fetching: false,
    })
    void triggerPrefetch()
  },
}))

/**
 * 异步预取一批推荐，去重后 append 到队列。
 * scopePath 下结果不足时自动逐级放宽。
 */
async function triggerPrefetch(): Promise<void> {
  const store = useDetailStore.getState()
  if (store.fetching) return
  store._setFetching(true)

  try {
    const state = useDetailStore.getState()
    const mode: ExploreMode = useUIStore.getState().exploreMode as ExploreMode
    const seenIds = new Set(state.sequence.map((m) => m.id))

    // 逐级放宽：scopePath → 父目录 → 全局
    const scopesToTry: Array<string | undefined> = [state.scopePath ?? undefined]
    if (state.scopePath) {
      const normalized = state.scopePath.replace(/\\/g, '/')
      const parts = normalized.split('/').filter(Boolean)
      if (parts.length > 1) {
        parts.pop()
        // 重新组合为反斜杠路径（Windows）
        const parent = (state.scopePath.startsWith('\\\\') ? '\\\\' : '') + parts.join('\\')
        scopesToTry.push(parent)
      }
      scopesToTry.push(undefined)
    }

    let items: MediaItem[] = []
    for (const scope of scopesToTry) {
      const candidates = await window.api.getRecommendations(FETCH_BATCH, mode, false, scope)
      items = candidates.filter((m) => !seenIds.has(m.id))
      if (items.length > 0) break
    }

    if (items.length === 0) {
      useDetailStore.getState()._setFetching(false)
      return
    }

    useDetailStore.getState()._appendItems(items)
  } catch {
    useDetailStore.getState()._setFetching(false)
  }
}

export { BUFFER_SIZE }
