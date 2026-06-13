import { useEffect, useState, useCallback, useMemo } from 'react'
import { MasonryPhotoAlbum } from 'react-photo-album'
import 'react-photo-album/masonry.css'
import { Loader2, FolderOpen, Heart, HeartOff, Trash2 } from 'lucide-react'
import { MediaCard } from '../components/MediaCard'
import { ContextMenu, type ContextMenuItem } from '../components/ContextMenu'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { useCategoriesStore } from '../stores/categories'
import { useLibraryStore } from '../stores/library'
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

interface Props {
  categoryId: number
}

/**
 * 分类视图 — 复用瀑布流，数据来自 getCategoryItems。
 *
 * 与探索视图的区别：
 * - 不分页（一次拉全），分类规模通常远小于全库
 * - 右键菜单只提供"喜欢/取消喜欢"、"在文件管理器中显示"、"从分类移除"
 * - "从分类移除"需要二次确认，避免误操作
 */
export function CategoryView({ categoryId }: Props): React.JSX.Element {
  const categories = useCategoriesStore((s) => s.categories)
  const removeItem = useCategoriesStore((s) => s.removeItem)
  const view = useLibraryStore((s) => s.view)

  const category = useMemo(
    () => categories.find((c) => c.id === categoryId),
    [categories, categoryId]
  )

  const [items, setItems] = useState<MediaItem[]>([])
  const [loading, setLoading] = useState(true)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<MediaItem | null>(null)

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
  }, [load])

  // 视图本身切到别的分类时，关闭弹窗，避免遗留
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMenu(null)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setConfirmRemove(null)
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

  const performRemove = useCallback(
    async (item: MediaItem) => {
      setItems((prev) => prev.filter((it) => it.id !== item.id))
      try {
        await removeItem(categoryId, item.id)
      } catch (err) {
        console.error('removeItemFromCategory failed:', err)
        // 失败回滚
        await load()
      }
    },
    [categoryId, removeItem, load]
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
          key: 'like',
          label: menu.item.liked ? '取消喜欢' : '喜欢',
          icon: menu.item.liked ? HeartOff : Heart,
          onClick: () => void handleLikeToggle(menu.item.id, !menu.item.liked)
        },
        {
          key: 'reveal',
          label: '在文件管理器中显示',
          icon: FolderOpen,
          onClick: () => void handleReveal(menu.item)
        },
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
      <div className="px-2 mb-3 flex items-baseline gap-3">
        <h2 className="text-lg font-semibold">{category?.name ?? '分类'}</h2>
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
          这个分类还没有内容，把媒体拖到左侧分类上即可加入
        </div>
      ) : (
        <MasonryPhotoAlbum
          photos={photos}
          columns={(containerWidth) => {
            if (containerWidth < 600) return 2
            if (containerWidth < 900) return 3
            if (containerWidth < 1200) return 4
            if (containerWidth < 1600) return 5
            return 6
          }}
          spacing={12}
          render={{
            photo: (_props, { photo, width, height }) => (
              <div style={{ width, height }}>
                <MediaCard
                  item={(photo as MediaPhoto).item}
                  onLikeToggle={handleLikeToggle}
                  onContextMenu={handleContextMenu}
                  onThumbError={handleThumbError}
                />
              </div>
            )
          }}
        />
      )}

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={closeMenu} />
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
    </div>
  )
}
