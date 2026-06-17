import { useEffect, useState, useCallback, useMemo } from 'react'
import { Loader2, FolderOpen, ExternalLink, Heart, HeartOff, Trash2, FolderPlus } from 'lucide-react'
import { MasonryGrid } from '../components/MasonryGrid'
import { ContextMenu, type ContextMenuItem } from '../components/ContextMenu'
import { CategoryPicker } from '../components/CategoryPicker'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { SelectionToolbar } from '../components/SelectionToolbar'
import { useCategoriesStore } from '../stores/categories'
import { useLibraryStore } from '../stores/library'
import { useGridSelection } from '../stores/selection'
import { useDetailStore } from '../stores/detail'
import type { MediaItem } from '../../../main/recommender'

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

interface Props {
  categoryId: number
}

export function CategoryView({ categoryId }: Props): React.JSX.Element {
  const categories = useCategoriesStore((s) => s.categories)
  const createCategory = useCategoriesStore((s) => s.create)
  const removeItem = useCategoriesStore((s) => s.removeItem)
  const removeItems = useCategoriesStore((s) => s.removeItems)
  const addItemsToCategory = useCategoriesStore((s) => s.addItems)
  const view = useLibraryStore((s) => s.view)
  const categoryRefreshNonce = useLibraryStore((s) => s.categoryRefreshNonce)
  const openDetail = useDetailStore((s) => s.open)

  const category = useMemo(
    () => categories.find((c) => c.id === categoryId),
    [categories, categoryId]
  )

  const [items, setItems] = useState<MediaItem[]>([])
  const [loading, setLoading] = useState(true)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [picker, setPicker] = useState<PickerState | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<MediaItem | null>(null)
  const [confirmBatchRemove, setConfirmBatchRemove] = useState(false)

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

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const list = await window.api.getCategoryItems(categoryId)
      setItems(list)
    } catch (err) {
      console.error('getCategoryItems failed:', err)
    } finally {
      setLoading(false)
    }
  }, [categoryId])

  useEffect(() => {
    void load()
  }, [load, categoryRefreshNonce])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMenu(null)
    setConfirmRemove(null)
    setConfirmBatchRemove(false)
  }, [view])

  const handleLikeToggle = useCallback(async (id: number, liked: boolean) => {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, liked: liked ? 1 : 0 } : it))
    )
    try {
      await window.api.setLiked(id, liked)
    } catch (err) {
      console.error('setLiked failed:', err)
    }
  }, [])

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

  const handleThumbError = useCallback(async (item: MediaItem) => {
    setItems((prev) => prev.filter((it) => it.id !== item.id))
    try {
      await window.api.markUnavailable(item.id, 'thumb-load-failed')
    } catch (err) {
      console.error('markUnavailable failed:', err)
    }
  }, [])

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
  }, [])

  const performRemove = useCallback(
    async (item: MediaItem) => {
      setItems((prev) => prev.filter((it) => it.id !== item.id))
      try {
        await removeItem(categoryId, item.id)
      } catch (err) {
        console.error('removeItemFromCategory failed:', err)
        await load()
      }
    },
    [categoryId, removeItem, load]
  )

  // ===== 批量操作 =====

  const handleBatchLike = useCallback(async () => {
    const ids = getSelectedIds()
    if (ids.length === 0) return
    const idSet = new Set(ids)
    setItems((prev) => prev.map((it) => (idSet.has(it.id) ? { ...it, liked: 1 } : it)))
    deselectAll()
    try {
      await window.api.setLikedBatch(ids, true)
    } catch (err) {
      console.error('setLikedBatch failed:', err)
    }
  }, [getSelectedIds, deselectAll])

  const handleBatchAddToCategory = useCallback(
    async (targetCategoryId: number) => {
      const ids = getSelectedIds()
      if (ids.length === 0) return
      deselectAll()
      try {
        await addItemsToCategory(targetCategoryId, ids)
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

  const performBatchRemove = useCallback(async () => {
    const ids = getSelectedIds()
    if (ids.length === 0) return
    const idSet = new Set(ids)
    deselectAll()
    setItems((prev) => prev.filter((it) => !idSet.has(it.id)))
    try {
      await removeItems(categoryId, ids)
    } catch (err) {
      console.error('removeItemsFromCategory failed:', err)
      await load()
    }
  }, [getSelectedIds, deselectAll, removeItems, categoryId, load])

  // 其他分类（排除当前分类）供"添加到分类"子菜单使用
  const otherCategories = useMemo(
    () => categories.filter((c) => c.id !== categoryId),
    [categories, categoryId]
  )

  const menuItems: ContextMenuItem[] = menu
    ? [
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
        ...(otherCategories.length > 0
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
          key: 'remove',
          label: '从分类移除',
          icon: Trash2,
          danger: true,
          onClick: () => setConfirmRemove(menu.item)
        }
      ]
    : []

  return (
    <div className="p-4">
      {loading && items.length === 0 ? (
        <div className="h-96 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      ) : items.length === 0 ? (
        <div className="h-96 flex items-center justify-center text-sm text-muted-foreground">
          这个分类还没有内容，把媒体拖到左侧分类上即可加入
        </div>
      ) : (
        <MasonryGrid
          items={items}
          resetKey={`cat:${categoryId}-${items.length}`}
          onLikeToggle={handleLikeToggle}
          onContextMenu={handleContextMenu}
          onThumbError={handleThumbError}
          onSelectClick={handleSelectClick}
          onLongPress={handleLongPress}
          onOpenDetail={openDetail}
        />
      )}

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={closeMenu} onSubmenuClose={() => setPicker(null)} />
      )}

      {picker && (
        <CategoryPicker
          x={picker.x}
          y={picker.y}
          parentLeft={picker.parentLeft}
          placement="submenu"
          categories={otherCategories}
          onSelect={(id) => void addItemsToCategory(id, [picker.item.id])}
          onCreateAndSelect={(name) => {
            const item = picker.item
            setPicker(null)
            void (async () => {
              const id = await createCategory(name)
              await addItemsToCategory(id, [item.id])
            })()
          }}
          onClose={() => setPicker(null)}
        />
      )}

      {confirmRemove && (
        <ConfirmDialog
          title="从分类移除"
          message={
            <>
              确定要将这一项从「<strong>{category?.name ?? ''}</strong>」中移除吗？
              <br />
              <span className="text-xs text-muted-foreground">
                只是移除关联，不会删除原始文件。
              </span>
            </>
          }
          confirmLabel="移除"
          danger
          onConfirm={() => {
            const it = confirmRemove
            setConfirmRemove(null)
            void performRemove(it)
          }}
          onCancel={() => setConfirmRemove(null)}
        />
      )}

      <SelectionToolbar
        active={selectionActive}
        count={selectedCount}
        totalCount={items.length}
        onClear={clearSelection}
        onSelectAll={handleSelectAll}
        onDeselectAll={deselectAll}
        categories={otherCategories}
        onLike={handleBatchLike}
        onAddToCategory={handleBatchAddToCategory}
        onCreateAndAddToCategory={handleBatchCreateAndAddToCategory}
        onRemoveFromCategory={() => setConfirmBatchRemove(true)}
      />

      {confirmBatchRemove && (
        <ConfirmDialog
          title="从分类移除"
          message={
            <>
              确定要将选中的 <strong>{selectedCount}</strong> 项从「
              <strong>{category?.name ?? ''}</strong>」中移除吗？
              <br />
              <span className="text-xs text-muted-foreground">
                只是移除关联，不会删除原始文件。
              </span>
            </>
          }
          confirmLabel="移除"
          danger
          onConfirm={() => {
            setConfirmBatchRemove(false)
            void performBatchRemove()
          }}
          onCancel={() => setConfirmBatchRemove(false)}
        />
      )}
    </div>
  )
}
