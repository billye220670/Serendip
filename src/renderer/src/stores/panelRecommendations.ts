import { create } from 'zustand'
import type { MediaItem, ExploreMode } from '../../../main/recommender'
import { useUIStore } from './ui'

interface PanelRecommendationsState {
  items: MediaItem[]
  hasMore: boolean
  isLoading: boolean
  _folderPath: string | null
  _rootPath: string | null
  _seenIds: Set<number>
  _abortController: AbortController | null
  _debounceTimer: ReturnType<typeof setTimeout> | null

  reset: (folderPath: string, rootPath: string) => void
  loadMore: () => void
  destroy: () => void
  _loadBatch: (count: number) => Promise<void>
}

export const usePanelRecommendationsStore = create<PanelRecommendationsState>((set, get) => ({
  items: [],
  hasMore: true,
  isLoading: false,
  _folderPath: null,
  _rootPath: null,
  _seenIds: new Set(),
  _abortController: null,
  _debounceTimer: null,

  reset: (folderPath: string, rootPath: string) => {
    const state = get()

    // 取消进行中的请求
    state._abortController?.abort()

    // 清掉防抖定时器
    if (state._debounceTimer !== null) {
      clearTimeout(state._debounceTimer)
    }

    // 清空状态
    set({
      items: [],
      hasMore: true,
      isLoading: false,
      _folderPath: folderPath,
      _rootPath: rootPath,
      _seenIds: new Set(),
      _abortController: null,
      _debounceTimer: null
    })

    // 200ms 防抖后触发初始加载
    const timer = setTimeout(() => {
      set({ _debounceTimer: null })
      get()._loadBatch(20)
    }, 200)

    set({ _debounceTimer: timer })
  },

  loadMore: () => {
    const state = get()
    if (state.isLoading) return
    if (!state.hasMore) return
    get()._loadBatch(10)
  },

  destroy: () => {
    const state = get()
    state._abortController?.abort()
    if (state._debounceTimer !== null) {
      clearTimeout(state._debounceTimer)
    }
    set({
      items: [],
      isLoading: false,
      _abortController: null,
      _debounceTimer: null,
      _folderPath: null,
      _rootPath: null,
      _seenIds: new Set(),
      hasMore: false
    })
  },

  _loadBatch: async (count: number) => {
    const state = get()
    if (state.isLoading) return
    if (!state._folderPath || !state._rootPath) return

    const ac = new AbortController()
    set({ isLoading: true, _abortController: ac })

    try {
      const mode = useUIStore.getState().exploreMode as ExploreMode

      const items = await window.api.getHierarchicalRecommendations(
        state._folderPath,
        state._rootPath,
        count,
        mode
      )

      // 检查是否已被取消
      if (ac.signal.aborted) return

      const current = get()
      // 去重
      const fresh = items.filter((m) => !current._seenIds.has(m.id))
      const newSeenIds = new Set(current._seenIds)
      fresh.forEach((m) => newSeenIds.add(m.id))

      set({
        items: [...current.items, ...fresh],
        hasMore: fresh.length > 0,
        isLoading: false,
        _seenIds: newSeenIds,
        _abortController: null
      })
    } catch (err) {
      if (ac.signal.aborted) return
      set({ isLoading: false, _abortController: null })
    }
  }
}))
