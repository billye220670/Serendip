import { useState } from 'react'
import {
  Heart,
  EyeOff,
  FolderPlus,
  Trash2,
  X,
  Square,
  CheckSquare,
  MinusSquare,
  Folder
} from 'lucide-react'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'
import type { Category } from '../../../main/categories'

interface SelectionToolbarProps {
  /** 是否处于多选模式 —— 决定浮条是否显示（即使没有选中项也保持可见） */
  active: boolean
  /** 已选数量 */
  count: number
  /** 当前视图已加载项总数（用于全选三态判断） */
  totalCount: number
  /** 退出多选（彻底关闭浮条） */
  onClear: () => void
  /** 全选当前已加载项 */
  onSelectAll?: () => void
  /** 仅清空选中、保留多选模式 */
  onDeselectAll?: () => void
  /** 可加入的分类列表（为空则不显示"加入分类"） */
  categories: Category[]
  /** 批量喜欢 */
  onLike?: () => void
  /** 批量不感兴趣（探索视图） */
  onDislike?: () => void
  /** 批量加入分类 */
  onAddToCategory?: (categoryId: number) => void
  /** 批量从当前分类移除（分类视图） */
  onRemoveFromCategory?: () => void
}

/**
 * 多选浮动工具条（阶段 5）。
 *
 * - 进入多选模式即显示，即使取消掉所有选中也保持可见（按 ✕ 才退出）
 * - 毛玻璃 + tint 底色保证可读性
 * - 按钮按传入的 handler 条件渲染：探索视图给"喜欢/不感兴趣/加入分类"，
 *   分类视图给"喜欢/加入分类/从分类移除"；这些操作在无选中时禁用
 * - 第一个是带状态的全选键：无/半选点击=全选，已全选点击=清空（仍留在多选模式）
 * - "加入分类"复用 ContextMenu，从按钮上方浮出
 */
export function SelectionToolbar({
  active,
  count,
  totalCount,
  onClear,
  onSelectAll,
  onDeselectAll,
  categories,
  onLike,
  onDislike,
  onAddToCategory,
  onRemoveFromCategory
}: SelectionToolbarProps): React.JSX.Element | null {
  const [catMenu, setCatMenu] = useState<{ x: number; y: number } | null>(null)

  if (!active) return null

  const hasSelection = count > 0
  const allSelected = totalCount > 0 && count >= totalCount
  const showAddToCategory = !!onAddToCategory && categories.length > 0

  // 全选三态：无选中 = 空框、部分 = 半框、全选 = 实框（点击=清空选中但留在多选）
  const selectAllIcon = allSelected ? CheckSquare : hasSelection ? MinusSquare : Square
  const selectAllLabel = allSelected ? '清空' : '全选'
  const onSelectAllClick = allSelected ? onDeselectAll : onSelectAll

  const catMenuItems: ContextMenuItem[] = [
    { key: 'h-cat', header: true, label: '加入分类' },
    ...categories.map<ContextMenuItem>((c) => ({
      key: `cat-${c.id}`,
      label: c.name,
      icon: Folder,
      onClick: () => onAddToCategory?.(c.id)
    }))
  ]

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
          onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
            setCatMenu({ x: r.left + r.width / 2, y: r.top })
          }}
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

      {catMenu && (
        <ContextMenu
          x={catMenu.x}
          y={catMenu.y}
          placement="top"
          items={catMenuItems}
          onClose={() => setCatMenu(null)}
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

