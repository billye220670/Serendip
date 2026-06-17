import { useState } from 'react'
import {
  Heart,
  HeartOff,
  EyeOff,
  FolderPlus,
  Trash2,
  X,
  Square,
  CheckSquare,
  MinusSquare,
  Presentation
} from 'lucide-react'
import { CategoryPicker } from './CategoryPicker'
import { CanvasPicker } from './CanvasPicker'
import type { Category } from '../../../main/categories'
import type { Canvas } from '../../../main/canvases'

interface SelectionToolbarProps {
  active: boolean
  count: number
  totalCount: number
  onClear: () => void
  onSelectAll?: () => void
  onDeselectAll?: () => void
  categories: Category[]
  canvases?: Canvas[]
  currentCanvasId?: number | null
  onLike?: () => void
  onUnlike?: () => void
  onDislike?: () => void
  onAddToCategory?: (categoryId: number) => void
  onCreateAndAddToCategory?: (name: string) => void
  onAddToCanvas?: (canvasId: number) => void
  onCreateAndAddToCanvas?: (name: string) => void
  onRemoveFromCategory?: () => void
}

export function SelectionToolbar({
  active,
  count,
  totalCount,
  onClear,
  onSelectAll,
  onDeselectAll,
  categories,
  canvases = [],
  currentCanvasId,
  onLike,
  onUnlike,
  onDislike,
  onAddToCategory,
  onCreateAndAddToCategory,
  onAddToCanvas,
  onCreateAndAddToCanvas,
  onRemoveFromCategory
}: SelectionToolbarProps): React.JSX.Element | null {
  const [pickerAnchor, setPickerAnchor] = useState<{ x: number; y: number } | null>(null)
  const [canvasPickerAnchor, setCanvasPickerAnchor] = useState<{ x: number; y: number } | null>(null)

  if (!active) return null

  const hasSelection = count > 0
  const allSelected = totalCount > 0 && count >= totalCount
  const showAddToCategory = !!onAddToCategory && categories.length > 0

  const selectAllIcon = allSelected ? CheckSquare : hasSelection ? MinusSquare : Square
  const selectAllLabel = allSelected ? '清空' : '全选'
  const onSelectAllClick = allSelected ? onDeselectAll : onSelectAll

  const openPicker = (e: React.MouseEvent): void => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setPickerAnchor({ x: r.left + r.width / 2, y: r.top })
  }

  const openCanvasPicker = (e: React.MouseEvent): void => {
    if (currentCanvasId != null) {
      onAddToCanvas?.(currentCanvasId)
      return
    }
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setCanvasPickerAnchor({ x: r.left + r.width / 2, y: r.top })
  }

  const showAddToCanvas = !!onAddToCanvas

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1 rounded-full border border-border bg-glass backdrop-blur-xl px-2 py-1.5 shadow-lg shadow-black/20">
      <span className="px-3 text-sm font-medium tabular-nums">已选 {count} 项</span>

      <div className="w-px h-5 bg-border mx-0.5" />

      {onSelectAllClick && (
        <ToolbarButton
          icon={selectAllIcon}
          label={selectAllLabel}
          onClick={onSelectAllClick}
        />
      )}
      {onLike && (
        <ToolbarButton icon={Heart} label="喜欢" disabled={!hasSelection} onClick={onLike} />
      )}
      {onUnlike && (
        <ToolbarButton
          icon={HeartOff}
          label="取消喜欢"
          disabled={!hasSelection}
          onClick={onUnlike}
        />
      )}
      {onDislike && (
        <ToolbarButton
          icon={EyeOff}
          label="不感兴趣"
          disabled={!hasSelection}
          onClick={onDislike}
        />
      )}
      {showAddToCategory && (
        <ToolbarButton
          icon={FolderPlus}
          label="加入分类"
          disabled={!hasSelection}
          onClick={openPicker}
        />
      )}
      {showAddToCanvas && (
        <ToolbarButton
          icon={Presentation}
          label="加入画布"
          disabled={!hasSelection}
          onClick={openCanvasPicker}
        />
      )}
      {onRemoveFromCategory && (
        <ToolbarButton
          icon={Trash2}
          label="移除"
          danger
          disabled={!hasSelection}
          onClick={onRemoveFromCategory}
        />
      )}

      <div className="w-px h-5 bg-border mx-0.5" />

      <button
        onClick={onClear}
        title="退出多选"
        className="p-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      >
        <X className="w-4 h-4" />
      </button>

      {pickerAnchor && (
        <CategoryPicker
          x={pickerAnchor.x}
          y={pickerAnchor.y}
          placement="top"
          categories={categories}
          onSelect={(id) => { onAddToCategory?.(id) }}
          onCreateAndSelect={(name) => { onCreateAndAddToCategory?.(name) }}
          onClose={() => setPickerAnchor(null)}
        />
      )}
      {canvasPickerAnchor && (
        <CanvasPicker
          x={canvasPickerAnchor.x}
          y={canvasPickerAnchor.y}
          placement="top"
          canvases={canvases}
          onSelect={(id) => { onAddToCanvas?.(id); setCanvasPickerAnchor(null) }}
          onCreateAndSelect={(name) => { onCreateAndAddToCanvas?.(name); setCanvasPickerAnchor(null) }}
          onClose={() => setCanvasPickerAnchor(null)}
        />
      )}
    </div>
  )
}

interface ToolbarButtonProps {
  icon: React.ElementType
  label: string
  danger?: boolean
  disabled?: boolean
  onClick: (e: React.MouseEvent) => void
}

function ToolbarButton({
  icon: Icon,
  label,
  danger,
  disabled,
  onClick
}: ToolbarButtonProps): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={
        'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent ' +
        (danger
          ? 'text-red-500 hover:bg-red-500/10'
          : 'text-foreground hover:bg-muted')
      }
    >
      <Icon className="w-4 h-4" />
      <span>{label}</span>
    </button>
  )
}
