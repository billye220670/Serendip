import { useEffect, useState, useCallback } from 'react'
import { MasonryPhotoAlbum } from 'react-photo-album'
import 'react-photo-album/masonry.css'
import { Loader2, FolderOpen, HeartOff, Folder } from 'lucide-react'
import { MediaCard } from '../components/MediaCard'
import { ContextMenu, type ContextMenuItem } from '../components/ContextMenu'
import { SelectionToolbar } from '../components/SelectionToolbar'
import { useCategoriesStore } from '../stores/categories'
import { useLibraryStore } from '../stores/library'
import { useUIStore } from '../stores/ui'
import { useGridSelection } from '../stores/selection'
import { useDetailStore } from '../stores/detail'
import { getColumns } from '../lib/grid'
import type { MediaItem } from '../../../main/recommender'

interface MediaPhoto {
  key: string
  src: string
  width: number
  height: number
  item: MediaItem
}

interface MenuState {
  x: number
  y: number
  item: MediaItem
}

/**
 * 喜欢视图 — 列出全库 liked=1 的项。
 *
 * 与分类视图相似：一次拉全（喜欢量级一般可控）、瀑布流复用。
 * 区别：
 * - 右键的"取消喜欢"会把项目从当前列表里剔除（既然这就是「喜欢」列表）
 * - 没有"从分类移除"和跨视图"移动 / 复制"那一套
 * - 批量喜欢也走"取消喜欢"语义（因为这里全是 liked）
 */
export function LikedView(): React.JSX.Element {
  const categories = useCategoriesStore((s) => s.categories)
  const addItemsToCategory = useCategoriesStore((s) => s.addItems)
  const view = useLibraryStore((s) => s.view)
  const loadStats = useLibraryStore((s) => s.loadStats)
  const gridSize = useUIStore((s) => s.gridSize)
  const openDetail = useDetailStore((s) => s.open)

  const [items, setItems] = useState<MediaItem[]>([])
  const [loading, setLoading] = useState(true)
  const [menu, setMenu] = useState<MenuState | null>(null)

  // 多选
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

  // 离开视图时清空选择
  useEffect(() => () => clearSelection(), [clearSelection])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const list = await window.api.listLiked()
      setItems(list)
    } catch (err) {
      console.error('listLiked failed:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // 切到别的视图时关闭菜单
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMenu(null)
  }, [view])

  /** 取消喜欢：从列表移除 + 持久化 + 刷新统计 */
  const performUnlike = useCallback(
    async (id: number) => {
      setItems((prev) => prev.filter((it) => it.id !== id))
      try {
        await window.api.setLiked(id, false)
        void loadStats()
      } catch (err) {
        console.error('setLiked failed:', err)
      }
    },
    [loadStats]
  )

  const handleLikeToggle = useCallback(
    async (id: number, liked: boolean) => {
      // 在喜欢视图里，唯一会触发的就是「取消喜欢」（liked=false）
      if (!liked) {
        await performUnlike(id)
      }
    },
    [performUnlike]
  )

  const handleReveal = useCallback(async (item: MediaItem) => {
    try {
      await window.api.revealInFolder(item.id)
    } catch (err) {
      console.error('revealInFolder failed:', err)
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

  const handleThumbError = useCallback(async (item: MediaItem) => {
    setItems((prev) => prev.filter((it) => it.id !== item.id))
    try {
      await window.api.markUnavailable(item.id, 'thumb-load-failed')
    } catch (err) {
      console.error('markUnavailable failed:', err)
    }
  }, [])

  const handleContextMenu = useCallback((e: React.MouseEvent, item: MediaItem) => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, item })
  }, [])

  const closeMenu = useCallback(() => setMenu(null), [])

  // ===== 批量操作 =====

  /** 批量取消喜欢：从列表移除 + 批写 + 刷新统计 */
  const handleBatchUnlike = useCallback(async () => {
    const ids = getSelectedIds()
    if (ids.length === 0) return
    const idSet = new Set(ids)
    deselectAll()
    setItems((prev) => prev.filter((it) => !idSet.has(it.id)))
    try {
      await window.api.setLikedBatch(ids, false)
      void loadStats()
    } catch (err) {
      console.error('setLikedBatch failed:', err)
    }
  }, [getSelectedIds, deselectAll, loadStats])

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

  const photos: MediaPhoto[] = items.map((item) => ({
    key: String(item.id),
    src: `serendip://thumb/${item.id}`,
    width: item.width || 4,
    height: item.height || 3,
    item
  }))

  const menuItems: ContextMenuItem[] = menu
    ? [
        {
          key: 'unlike',
          label: '取消喜欢',
          icon: HeartOff,
          onClick: () => void performUnlike(menu.item.id)
        },
        {
          key: 'reveal',
          label: '在文件管理器中显示',
          icon: FolderOpen,
          onClick: () => void handleReveal(menu.item)
        },
        // 加入分类（仅有分类时显示）
        ...(categories.length > 0
          ? ([
              { key: 'div-cat', divider: true },
              { key: 'h-cat', header: true, label: '添加到分类' },
              ...categories.map<ContextMenuItem>((c) => ({
                key: `cat-${c.id}`,
                label: c.name,
                icon: Folder,
                onClick: () => void handleAddToCategory(menu.item, c.id)
              }))
            ] as ContextMenuItem[])
          : [])
      ]
    : []

  return (
    <div className="p-4">
      <div className="px-2 mb-3 flex items-baseline gap-3">
        <h2 className="text-lg font-semibold">喜欢</h2>
        <span className="text-xs text-muted-foreground">
          {items.length.toLocaleString()} 项
        </span>
      </div>

      {loading && items.length === 0 ? (
        <div className="h-96 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      ) : items.length === 0 ? (
        <div className="h-96 flex items-center justify-center text-sm text-muted-foreground">
          还没有喜欢的内容，到探索或评审里给几张点个心试试
        </div>
      ) : (
        <MasonryPhotoAlbum
          photos={photos}
          columns={(containerWidth) => getColumns(containerWidth, gridSize)}
          spacing={12}
          render={{
            photo: (_props, { photo, width, height }) => (
              <div style={{ width, height }}>
                <MediaCard
                  item={(photo as MediaPhoto).item}
                  onLikeToggle={handleLikeToggle}
                  onContextMenu={handleContextMenu}
                  onThumbError={handleThumbError}
                  onSelectClick={handleSelectClick}
                  onLongPress={handleLongPress}
                  onOpenDetail={openDetail}
                />
              </div>
            )
          }}
        />
      )}

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={closeMenu} />
      )}

      <SelectionToolbar
        active={selectionActive}
        count={selectedCount}
        totalCount={items.length}
        onClear={clearSelection}
        onSelectAll={handleSelectAll}
        onDeselectAll={deselectAll}
        categories={categories}
        onUnlike={handleBatchUnlike}
        onAddToCategory={handleBatchAddToCategory}
      />
    </div>
  )
}
