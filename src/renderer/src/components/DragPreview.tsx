import { Folder, Play } from 'lucide-react'
import type { MediaItem } from '../../../main/recommender'

/**
 * 拖拽浮层内容 — 跟随光标的预览。
 *
 * - 媒体（图片 / 视频）：渲染缩略图（serendip://thumb/<id>，图片视频通用），
 *   视频额外叠一个播放角标，让用户拖拽时也能看出类型
 * - 分类：渲染一个带文件夹图标的胶囊
 */

export function MediaDragPreview({
  item,
  count = 1
}: {
  item: MediaItem
  count?: number
}): React.JSX.Element {
  // 固定宽度，按原始宽高比推算高度（缺失时退化为 1:1）
  const w = 140
  const ratio = item.width && item.height ? item.height / item.width : 1
  const h = Math.round(w * ratio)
  const multi = count > 1

  return (
    <div style={{ width: w }} className="relative">
      {/* 多选时叠一层"卡片堆"的错位阴影，暗示拖的是一组 */}
      {multi && (
        <div
          style={{ height: Math.min(h, 200) }}
          className="absolute inset-0 translate-x-2 translate-y-2 rounded-lg bg-muted ring-2 ring-primary/60 rotate-6"
        />
      )}
      <div
        style={{ height: Math.min(h, 200) }}
        className="relative rounded-lg overflow-hidden shadow-2xl shadow-black/40 ring-2 ring-primary rotate-3 cursor-grabbing"
      >
        <img
          src={`serendip://thumb/${item.id}`}
          alt=""
          className="w-full h-full object-cover pointer-events-none"
          draggable={false}
        />
        {item.type === 'video' && (
          <div className="absolute top-1.5 right-1.5 bg-black/60 backdrop-blur rounded-full p-1">
            <Play className="w-3 h-3 text-white fill-white" />
          </div>
        )}
      </div>
      {/* 数量角标 */}
      {multi && (
        <div className="absolute -top-2 -right-2 z-10 min-w-[22px] h-[22px] px-1.5 flex items-center justify-center rounded-full bg-primary text-white text-xs font-bold shadow-lg">
          {count}
        </div>
      )}
    </div>
  )
}

export function CategoryDragPreview({ name }: { name: string }): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-background border border-primary shadow-2xl shadow-black/40 text-sm cursor-grabbing">
      <Folder className="w-4 h-4 text-primary flex-shrink-0" />
      <span className="truncate max-w-[180px]">{name}</span>
    </div>
  )
}
