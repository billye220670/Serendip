import { Folder, Play } from 'lucide-react'
import type { MediaItem } from '../../../main/recommender'

/**
 * 拖拽浮层内容 — 跟随光标的预览。
 *
 * - 媒体（图片 / 视频）：渲染缩略图（serendip://thumb/<id>，图片视频通用），
 *   视频额外叠一个播放角标，让用户拖拽时也能看出类型
 * - 分类：渲染一个带文件夹图标的胶囊
 */

export function MediaDragPreview({ item }: { item: MediaItem }): React.JSX.Element {
  // 固定宽度，按原始宽高比推算高度（缺失时退化为 1:1）
  const w = 140
  const ratio = item.width && item.height ? item.height / item.width : 1
  const h = Math.round(w * ratio)

  return (
    <div
      style={{ width: w, height: Math.min(h, 200) }}
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
