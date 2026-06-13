import { useEffect, useState, useCallback, useRef } from 'react'
import { MasonryPhotoAlbum } from 'react-photo-album'
import 'react-photo-album/masonry.css'
import { useInView } from 'react-intersection-observer'
import { Loader2, Heart, HeartOff, EyeOff, FolderOpen, Folder } from 'lucide-react'
import { MediaCard } from '../components/MediaCard'
import { ContextMenu, type ContextMenuItem } from '../components/ContextMenu'
import { useUIStore } from '../stores/ui'
import { useLibraryStore } from '../stores/library'
import { useCategoriesStore } from '../stores/categories'
import type { MediaItem } from '../../../main/recommender'

const BATCH_SIZE = 30

// react-photo-album 的 Photo 类型扩展，挂载我们的 MediaItem
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

export function ExploreView(): React.JSX.Element {
  const exploreMode = useUIStore((s) => s.exploreMode)
  const rootPath = useLibraryStore((s) => s.rootPath)
  const loadStats = useLibraryStore((s) => s.loadStats)
  const categories = useCategoriesStore((s) => s.categories)
  const addItemsToCategory = useCategoriesStore((s) => s.addItems)

  const [items, setItems] = useState<MediaItem[]>([])
  const [loading, setLoading] = useState(false)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const seenIdsRef = useRef<Set<number>>(new Set())
  const loadingRef = useRef(false)
  const hasMoreRef = useRef(true)

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
        // 如果连续两次拿不到新内容，认为没更多了
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

  // 切换模式或根目录时重置
  useEffect(() => {
    seenIdsRef.current = new Set()
    hasMoreRef.current = true
    setItems([])
    void loadMore(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exploreMode, rootPath])

  // 触底自动加载
  const { ref: bottomRef, inView } = useInView({ rootMargin: '600px' })
  useEffect(() => {
    if (inView && items.length > 0) {
      void loadMore(false)
    }
  }, [inView, items.length, loadMore])

  /** 从当前列表移除一项（不感兴趣 / 失效），并补刀加载 */
  const removeItem = useCallback(
    (id: number) => {
      setItems((prev) => {
        const next = prev.filter((it) => it.id !== id)
        // 列表过短时主动拉一批，保证瀑布流不空
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
      // 先更新 UI 中那一项（非阻塞），再持久化
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

  /** 缩略图加载失败 → 标记失效并从列表移除 */
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

  const handleContextMenu = useCallback((e: React.MouseEvent, item: MediaItem) => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, item })
  }, [])

  const closeMenu = useCallback(() => setMenu(null), [])

  // 把 MediaItem 转换成 react-photo-album 接受的 Photo 形态
  const photos: MediaPhoto[] = items.map((item) => ({
    key: String(item.id),
    src: `serendip://thumb/${item.id}`,
    width: item.width || 4,
    height: item.height || 3,
    item
  }))

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
        // 添加到分类（只有存在分类时才显示）
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

      {/* 触底哨兵 */}
      <div ref={bottomRef} className="h-1" />

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
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={closeMenu} />
      )}
    </div>
  )
}
