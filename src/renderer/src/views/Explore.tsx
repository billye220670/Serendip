import { useEffect, useState, useCallback, useRef } from 'react'
import { MasonryPhotoAlbum } from 'react-photo-album'
import 'react-photo-album/masonry.css'
import { useInView } from 'react-intersection-observer'
import { Loader2 } from 'lucide-react'
import { MediaCard } from '../components/MediaCard'
import { useUIStore } from '../stores/ui'
import { useLibraryStore } from '../stores/library'
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

export function ExploreView(): React.JSX.Element {
  const exploreMode = useUIStore((s) => s.exploreMode)
  const rootPath = useLibraryStore((s) => s.rootPath)

  const [items, setItems] = useState<MediaItem[]>([])
  const [loading, setLoading] = useState(false)
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

  const handleLikeToggle = useCallback(async (id: number, liked: boolean) => {
    await window.api.setLiked(id, liked)
  }, [])

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
    </div>
  )
}
