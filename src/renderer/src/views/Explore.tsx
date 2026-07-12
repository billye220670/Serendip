import { useEffect, useState, useCallback, useRef } from 'react'
import { Loader2, Heart, HeartOff, EyeOff, FolderOpen, ExternalLink, FolderPlus } from 'lucide-react'
import { MasonryGrid } from '../components/MasonryGrid'
import { ContextMenu, type ContextMenuItem } from '../components/ContextMenu'
import { CategoryPicker } from '../components/CategoryPicker'
import { SelectionToolbar } from '../components/SelectionToolbar'
import { pushCanvasToast, pushPluginToast } from '../components/Toast'
import { useP2VMenu } from '../hooks/useP2VMenu'
import { useUIStore } from '../stores/ui'
import { useLibraryStore } from '../stores/library'
import { useCategoriesStore } from '../stores/categories'
import { useCanvasesStore } from '../stores/canvases'
import { useCurrentCanvasStore } from '../stores/currentCanvas'
import { useGridSelection } from '../stores/selection'
import { useDetailStore } from '../stores/detail'
import { useP2VEnabled, useP2VPort } from '../stores/plugins'
import { P2V_WORKFLOWS } from '../lib/p2vWorkflows'
import type { MediaItem } from '../../../main/recommender'

const BATCH_SIZE = 30

interface MenuState {
  x: number
  y: number
  item: MediaItem
}

interface PickerState {
  x: number
  y: number
  parentLeft: number
  item: MediaItem
}

export function ExploreView(): React.JSX.Element {
  const exploreMode = useUIStore((s) => s.exploreMode)
  const rootPath = useLibraryStore((s) => s.rootPath)
  const loadStats = useLibraryStore((s) => s.loadStats)
  const categories = useCategoriesStore((s) => s.categories)
  const createCategory = useCategoriesStore((s) => s.create)
  const addItemsToCategory = useCategoriesStore((s) => s.addItems)
  const canvases = useCanvasesStore((s) => s.canvases)
  const addItemsToCanvas = useCanvasesStore((s) => s.addItems)
  const currentCanvasId = useCurrentCanvasStore((s) => s.currentCanvasId)
  const openDetail = useDetailStore((s) => s.open)
  const p2vEnabled = useP2VEnabled()
  const p2vPort = useP2VPort()
  const { buildP2VItems, p2vPickerNode, closeP2VPicker } = useP2VMenu()

  const [items, setItems] = useState<MediaItem[]>([])
  const [loading, setLoading] = useState(false)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [picker, setPicker] = useState<PickerState | null>(null)
  const seenIdsRef = useRef<Set<number>>(new Set())
  const loadingRef = useRef(false)
  const hasMoreRef = useRef(true)

  const {
    selectedCount,
    selectionActive,
    handleSelectClick,
    handleLongPress,
    handleSelectAll,
    getSelectedIds,
    deselectAll,
    clear: clearSelection
  } = useGridSelection(items)

  useEffect(() => () => clearSelection(), [clearSelection])

  const loadMore = useCallback(
    async (initial = false): Promise<void> => {
      if (loadingRef.current) return
      if (!initial && !hasMoreRef.current) return
      loadingRef.current = true
      setLoading(true)
      try {
        const batch = await window.api.getRecommendations(BATCH_SIZE, exploreMode)
        const fresh = batch.filter(
          (it) => it && it.id != null && !seenIdsRef.current.has(it.id)
        )
        for (const f of fresh) seenIdsRef.current.add(f.id)
        if (fresh.length === 0 && !initial) {
          hasMoreRef.current = false
        } else {
          hasMoreRef.current = true
        }
        setItems((prev) => (initial ? fresh : [...prev, ...fresh]))
      } catch (err) {
        console.error('Failed to load recommendations:', err)
      } finally {
        loadingRef.current = false
        setLoading(false)
      }
    },
    [exploreMode]
  )

  useEffect(() => {
    seenIdsRef.current = new Set()
    hasMoreRef.current = true
    setItems([])
    void loadMore(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exploreMode, rootPath])

  const handleLoadMore = useCallback(() => {
    void loadMore(false)
  }, [loadMore])

  const removeItem = useCallback(
    (id: number) => {
      setItems((prev) => {
        const next = prev.filter((it) => it.id !== id)
        if (next.length < BATCH_SIZE / 2 && hasMoreRef.current) {
          void loadMore(false)
        }
        return next
      })
    },
    [loadMore]
  )

  const handleLikeToggle = useCallback(
    async (id: number, liked: boolean) => {
      setItems((prev) =>
        prev.map((it) => (it.id === id ? { ...it, liked: liked ? 1 : 0 } : it))
      )
      try {
        await window.api.setLiked(id, liked)
        void loadStats()
      } catch (err) {
        console.error('setLiked failed:', err)
      }
    },
    [loadStats]
  )

  const handleDislike = useCallback(
    async (item: MediaItem) => {
      removeItem(item.id)
      try {
        await window.api.setDisliked(item.id, true)
      } catch (err) {
        console.error('setDisliked failed:', err)
      }
    },
    [removeItem]
  )

  const handleReveal = useCallback(async (item: MediaItem) => {
    try {
      await window.api.revealInFolder(item.id)
    } catch (err) {
      console.error('revealInFolder failed:', err)
    }
  }, [])

  const handleOpenFile = useCallback(async (item: MediaItem) => {
    try {
      await window.api.openFile(item.id)
    } catch (err) {
      console.error('openFile failed:', err)
    }
  }, [])

  const handleAddToCategory = useCallback(
    async (item: MediaItem, categoryId: number) => {
      try {
        await addItemsToCategory(categoryId, [item.id])
      } catch (err) {
        console.error('addItemsToCategory failed:', err)
      }
    },
    [addItemsToCategory]
  )

  const handleCreateAndAddToCategory = useCallback(
    async (item: MediaItem, name: string) => {
      try {
        const id = await createCategory(name)
        await addItemsToCategory(id, [item.id])
      } catch (err) {
        console.error('createAndAddToCategory failed:', err)
      }
    },
    [createCategory, addItemsToCategory]
  )

  const handleThumbError = useCallback(
    async (item: MediaItem) => {
      removeItem(item.id)
      try {
        await window.api.markUnavailable(item.id, 'thumb-load-failed')
      } catch (err) {
        console.error('markUnavailable failed:', err)
      }
    },
    [removeItem]
  )

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, item: MediaItem) => {
      if (selectionActive) return
      e.preventDefault()
      setMenu({ x: e.clientX, y: e.clientY, item })
    },
    [selectionActive]
  )

  const closeMenu = useCallback(() => {
    setMenu(null)
    setPicker(null)
    closeP2VPicker()
  }, [closeP2VPicker])

  // ===== 批量操作 =====

  const handleBatchLike = useCallback(async () => {
    const ids = getSelectedIds()
    if (ids.length === 0) return
    const idSet = new Set(ids)
    setItems((prev) => prev.map((it) => (idSet.has(it.id) ? { ...it, liked: 1 } : it)))
    deselectAll()
    try {
      await window.api.setLikedBatch(ids, true)
      void loadStats()
    } catch (err) {
      console.error('setLikedBatch failed:', err)
    }
  }, [getSelectedIds, deselectAll, loadStats])

  const handleBatchDislike = useCallback(async () => {
    const ids = getSelectedIds()
    if (ids.length === 0) return
    const idSet = new Set(ids)
    deselectAll()
    setItems((prev) => {
      const next = prev.filter((it) => !idSet.has(it.id))
      if (next.length < BATCH_SIZE / 2 && hasMoreRef.current) void loadMore(false)
      return next
    })
    try {
      await window.api.setDislikedBatch(ids, true)
    } catch (err) {
      console.error('setDislikedBatch failed:', err)
    }
  }, [getSelectedIds, deselectAll, loadMore])

  const handleBatchAddToCategory = useCallback(
    async (categoryId: number) => {
      const ids = getSelectedIds()
      if (ids.length === 0) return
      deselectAll()
      try {
        await addItemsToCategory(categoryId, ids)
      } catch (err) {
        console.error('addItemsToCategory failed:', err)
      }
    },
    [getSelectedIds, deselectAll, addItemsToCategory]
  )

  const handleBatchCreateAndAddToCategory = useCallback(
    async (name: string) => {
      const ids = getSelectedIds()
      if (ids.length === 0) return
      deselectAll()
      try {
        const id = await createCategory(name)
        await addItemsToCategory(id, ids)
      } catch (err) {
        console.error('batchCreateAndAdd failed:', err)
      }
    },
    [getSelectedIds, deselectAll, createCategory, addItemsToCategory]
  )

  const handleBatchAddToCanvas = useCallback(
    async (canvasId: number) => {
      const ids = getSelectedIds()
      if (ids.length === 0) return
      const canvas = canvases.find((c) => c.id === canvasId)
      if (!canvas) return
      deselectAll()
      try {
        await addItemsToCanvas(canvasId, ids)
        pushCanvasToast(canvasId, canvas.name, ids.length)
      } catch (err) {
        console.error('batchAddToCanvas failed:', err)
      }
    },
    [getSelectedIds, deselectAll, canvases, addItemsToCanvas]
  )

  const handleBatchCreateAndAddToCanvas = useCallback(
    async (name: string) => {
      const ids = getSelectedIds()
      if (ids.length === 0) return
      deselectAll()
      try {
        const canvasId = await window.api.createCanvas(name)
        await useCanvasesStore.getState().load()
        await addItemsToCanvas(canvasId, ids)
        pushCanvasToast(canvasId, name, ids.length)
      } catch (err) {
        console.error('batchCreateAndAddToCanvas failed:', err)
      }
    },
    [getSelectedIds, deselectAll, addItemsToCanvas]
  )

  if (items.length === 0 && loading) {
    return (
      <div className="h-96 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    )
  }

  if (items.length === 0 && !loading) {
    return (
      <div className="h-96 flex items-center justify-center text-muted-foreground text-sm">
        没有内容可推荐，先扫描一个根目录吧
      </div>
    )
  }

  const menuItems: ContextMenuItem[] = menu
    ? [
        ...buildP2VItems(menu.item),
        {
          key: 'like',
          label: menu.item.liked ? '取消喜欢' : '喜欢',
          icon: menu.item.liked ? HeartOff : Heart,
          onClick: () => void handleLikeToggle(menu.item.id, !menu.item.liked)
        },
        {
          key: 'open',
          label: '使用默认应用打开',
          icon: ExternalLink,
          onClick: () => void handleOpenFile(menu.item)
        },
        {
          key: 'reveal',
          label: '在文件管理器中显示',
          icon: FolderOpen,
          onClick: () => void handleReveal(menu.item)
        },
        ...(categories.length > 0
          ? ([
              { key: 'div-cat', divider: true },
              {
                key: 'add-to-cat',
                label: '添加到分类',
                icon: FolderPlus,
                submenuOpen: !!picker,
                onSubmenuOpen: (rect: DOMRect) => {
                  setPicker({ x: rect.right, y: rect.top, parentLeft: rect.left, item: menu.item })
                }
              }
            ] as ContextMenuItem[])
          : []),
        { key: 'div-end', divider: true },
        {
          key: 'dislike',
          label: '不感兴趣',
          icon: EyeOff,
          danger: true,
          onClick: () => void handleDislike(menu.item)
        }
      ]
    : []

  return (
    <div className="p-4">
      <MasonryGrid
        items={items}
        resetKey={`${exploreMode}:${rootPath ?? ''}`}
        onLoadMore={handleLoadMore}
        onLikeToggle={handleLikeToggle}
        onContextMenu={handleContextMenu}
        onThumbError={handleThumbError}
        onSelectClick={handleSelectClick}
        onLongPress={handleLongPress}
        onOpenDetail={openDetail}
      />

      {loading && (
        <div className="flex justify-center py-6">
          <Loader2 className="w-5 h-5 animate-spin text-primary" />
        </div>
      )}

      {!hasMoreRef.current && !loading && (
        <div className="py-6 text-center text-xs text-muted-foreground">
          已抽样完所有可用内容
        </div>
      )}

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={closeMenu} onSubmenuClose={() => { setPicker(null); closeP2VPicker() }} />
      )}

      {p2vPickerNode}

      {picker && (
        <CategoryPicker
          x={picker.x}
          y={picker.y}
          parentLeft={picker.parentLeft}
          placement="submenu"
          categories={categories}
          onSelect={(id) => void handleAddToCategory(picker.item, id)}
          onCreateAndSelect={(name) => void handleCreateAndAddToCategory(picker.item, name)}
          onClose={() => setPicker(null)}
        />
      )}

      <SelectionToolbar
        active={selectionActive}
        count={selectedCount}
        totalCount={items.length}
        onClear={clearSelection}
        onSelectAll={handleSelectAll}
        onDeselectAll={deselectAll}
        categories={categories}
        canvases={canvases}
        currentCanvasId={currentCanvasId}
        onLike={handleBatchLike}
        onDislike={handleBatchDislike}
        onAddToCategory={handleBatchAddToCategory}
        onCreateAndAddToCategory={handleBatchCreateAndAddToCategory}
        onAddToCanvas={handleBatchAddToCanvas}
        onCreateAndAddToCanvas={handleBatchCreateAndAddToCanvas}
        {...(p2vEnabled
          ? {
              onP2VSend: (wf: number) => {
                const ids = getSelectedIds()
                if (!ids.length) return
                deselectAll()
                const name = P2V_WORKFLOWS.find((w) => w.id === wf)?.name
                void window.api
                  .pluginP2VPush(ids, wf, p2vPort)
                  .then((r) =>
                    pushPluginToast(r.error ? r.error : `已发送 ${r.sent} 张到 P2V · ${name}`)
                  )
                  .catch((err) => {
                    console.error('pluginP2VPush failed:', err)
                    pushPluginToast('发送到 P2V 失败，请稍后重试')
                  })
              }
            }
          : {})}
      />
    </div>
  )
}
