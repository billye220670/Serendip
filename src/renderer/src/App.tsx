import { useEffect, useState, useCallback } from 'react'
import {
  DndContext,
  DragOverlay,
  pointerWithin,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type CollisionDetection,
  type Modifier
} from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import { getEventCoordinates } from '@dnd-kit/utilities'
import { useUIStore } from './stores/ui'
import { useLibraryStore } from './stores/library'
import { useCategoriesStore } from './stores/categories'
import { useSelectionStore } from './stores/selection'
import { ExploreView } from './views/Explore'
import { CategoryView } from './views/CategoryView'
import { ReviewView } from './views/Review'
import { CategoryList } from './components/CategoryList'
import { PromptDialog } from './components/PromptDialog'
import { ConfirmDialog } from './components/ConfirmDialog'
import { ContextMenu } from './components/ContextMenu'
import { MediaDragPreview, CategoryDragPreview } from './components/DragPreview'
import { GRID_SIZE_LABEL } from './lib/grid'
import {
  Sun,
  Moon,
  Compass,
  Star,
  Heart,
  Loader2,
  RefreshCw,
  Plus,
  LayoutGrid,
  FolderInput,
  Copy
} from 'lucide-react'
import clsx from 'clsx'
import type { Category } from '../../main/categories'
import type { MediaItem } from '../../main/recommender'

type DragType = 'category' | 'media' | null

/** 当前拖拽中的对象，用于渲染 DragOverlay 浮层 */
type ActiveDrag =
  | { type: 'media'; item: MediaItem; count: number }
  | { type: 'category'; name: string }
  | null

/**
 * 让 DragOverlay 浮层中心始终吸附到鼠标位置（像大多数软件那样）。
 *
 * dnd-kit 默认把浮层锚定在"抓取时元素所在位置 + 位移"，
 * 这里改成以光标为中心：用浮层自身尺寸（overlayNodeRect）计算偏移，
 * 因为浮层尺寸和源卡片不同。
 */
const snapToCursor: Modifier = ({
  activatorEvent,
  draggingNodeRect,
  overlayNodeRect,
  transform
}) => {
  if (!draggingNodeRect || !activatorEvent) return transform
  const coords = getEventCoordinates(activatorEvent)
  if (!coords) return transform
  const rect = overlayNodeRect ?? draggingNodeRect
  return {
    ...transform,
    x: transform.x + coords.x - draggingNodeRect.left - rect.width / 2,
    y: transform.y + coords.y - draggingNodeRect.top - rect.height / 2
  }
}

/**
 * 以鼠标位置判断投放目标（而非浮层的包围盒）。
 *
 * - 优先 pointerWithin：指针必须真正落在某个 droppable 上才命中
 * - 媒体拖拽：严格模式，落空就返回空，绝不"就近"高亮分类
 *   （指针没到分类上时不该有任何响应，便于将来扩展其它拖拽行为）
 * - 分类重排：落空时回退 closestCenter，让指针在行间隙也能顺滑排序
 */
const collisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args)
  if (pointerCollisions.length > 0) return pointerCollisions
  if (args.active.data.current?.type === 'media') return []
  return closestCenter(args)
}

function App(): React.JSX.Element {
  const { theme, toggleTheme, exploreMode, setExploreMode } = useUIStore()
  const gridSize = useUIStore((s) => s.gridSize)
  const cycleGridSize = useUIStore((s) => s.cycleGridSize)
  const {
    rootPath,
    isScanning,
    scanProgress,
    stats,
    view,
    setView,
    loadCurrentRoot,
    startScan,
    bumpCategoryRefresh
  } = useLibraryStore()
  const categories = useCategoriesStore((s) => s.categories)
  const loadCategories = useCategoriesStore((s) => s.load)
  const createCategory = useCategoriesStore((s) => s.create)
  const renameCategory = useCategoriesStore((s) => s.rename)
  const removeCategory = useCategoriesStore((s) => s.remove)
  const reorderCategories = useCategoriesStore((s) => s.reorder)
  const addItemsToCategory = useCategoriesStore((s) => s.addItems)
  const removeItemsFromCategory = useCategoriesStore((s) => s.removeItems)

  // 弹窗状态
  const [showCreate, setShowCreate] = useState(false)
  const [renameTarget, setRenameTarget] = useState<Category | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null)

  // 拖拽状态
  const [dragType, setDragType] = useState<DragType>(null)
  const [activeDrag, setActiveDrag] = useState<ActiveDrag>(null)
  const [hoveredDropCategoryId, setHoveredDropCategoryId] = useState<number | null>(
    null
  )
  // 从分类拖到另一分类时的"移动/复制"投放菜单
  const [dropMenu, setDropMenu] = useState<{
    x: number
    y: number
    sourceCategoryId: number
    targetCategoryId: number
    ids: number[]
  } | null>(null)

  // 8px 的距离阈值：单击不会触发拖拽
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

  useEffect(() => {
    loadCurrentRoot()
    void loadCategories()
  }, [loadCurrentRoot, loadCategories])

  const handleSelectRoot = async (): Promise<void> => {
    const path = await window.api.selectRootDirectory()
    if (path) {
      await startScan(path)
    }
  }

  const handleRescan = async (): Promise<void> => {
    if (rootPath) await startScan(rootPath)
  }

  const handleDragStart = useCallback((e: DragStartEvent) => {
    const data = e.active.data.current
    const t = data?.type
    if (t === 'media') {
      // 若拖的是已选中的项且选中多于 1，则整组一起拖
      const fileId = data?.fileId as number
      const sel = useSelectionStore.getState().selected
      const count = sel.has(fileId) && sel.size > 1 ? sel.size : 1
      setDragType('media')
      setActiveDrag({ type: 'media', item: data?.item as MediaItem, count })
    } else if (t === 'category') {
      setDragType('category')
      setActiveDrag({ type: 'category', name: data?.name as string })
    }
  }, [])

  const handleDragOver = useCallback(
    (e: DragOverEvent) => {
      if (dragType !== 'media') return
      const overData = e.over?.data.current
      if (overData?.type === 'category') {
        setHoveredDropCategoryId(overData.categoryId as number)
      } else {
        setHoveredDropCategoryId(null)
      }
    },
    [dragType]
  )

  const handleDragEnd = useCallback(
    async (e: DragEndEvent) => {
      const activeType = e.active.data.current?.type
      const overData = e.over?.data.current

      // 重置拖拽状态
      setDragType(null)
      setActiveDrag(null)
      setHoveredDropCategoryId(null)

      if (!e.over) return

      // 1) 分类重排
      if (activeType === 'category' && overData?.type === 'category') {
        const oldIndex = categories.findIndex(
          (c) => c.id === e.active.data.current?.categoryId
        )
        const newIndex = categories.findIndex(
          (c) => c.id === overData.categoryId
        )
        if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
          const reordered = arrayMove(categories, oldIndex, newIndex)
          await reorderCategories(reordered.map((c) => c.id))
        }
        return
      }

      // 2) 媒体投放到分类
      if (activeType === 'media' && overData?.type === 'category') {
        const fileId = e.active.data.current?.fileId as number
        const targetCategoryId = overData.categoryId as number
        const sel = useSelectionStore.getState().selected
        const ids = sel.has(fileId) && sel.size > 1 ? [...sel] : [fileId]
        const sourceCategoryId = view.kind === 'category' ? view.id : null

        // 从某分类拖到「另一个」分类：弹"移动 / 复制"菜单，锚定在目标 tab 右侧
        if (sourceCategoryId !== null && sourceCategoryId !== targetCategoryId) {
          const rect = e.over.rect
          setDropMenu({
            x: rect.right,
            y: rect.top,
            sourceCategoryId,
            targetCategoryId,
            ids
          })
          return
        }

        // 其余情况（探索来源、或拖回当前分类自身）：直接加入
        try {
          await addItemsToCategory(targetCategoryId, ids)
          if (ids.length > 1) useSelectionStore.getState().deselectAll()
        } catch (err) {
          console.error('addItemsToCategory failed:', err)
        }
      }
    },
    [categories, reorderCategories, addItemsToCategory, view]
  )

  // 投放菜单：移动到此 = 加到目标 + 从来源移除；复制到此 = 仅加到目标
  const handleDropMove = useCallback(async () => {
    if (!dropMenu) return
    const { sourceCategoryId, targetCategoryId, ids } = dropMenu
    setDropMenu(null)
    useSelectionStore.getState().deselectAll()
    try {
      await addItemsToCategory(targetCategoryId, ids)
      await removeItemsFromCategory(sourceCategoryId, ids)
      // 当前正看的就是来源分类，触发其重载，移走的项消失
      bumpCategoryRefresh()
    } catch (err) {
      console.error('move to category failed:', err)
    }
  }, [dropMenu, addItemsToCategory, removeItemsFromCategory, bumpCategoryRefresh])

  const handleDropCopy = useCallback(async () => {
    if (!dropMenu) return
    const { targetCategoryId, ids } = dropMenu
    setDropMenu(null)
    useSelectionStore.getState().deselectAll()
    try {
      await addItemsToCategory(targetCategoryId, ids)
    } catch (err) {
      console.error('copy to category failed:', err)
    }
  }, [dropMenu, addItemsToCategory])

  const handleCreateCategory = async (
    name: string
  ): Promise<void | string> => {
    try {
      await createCategory(name)
      setShowCreate(false)
    } catch (err) {
      return err instanceof Error ? err.message : String(err)
    }
  }

  const handleRenameCategory = async (
    name: string
  ): Promise<void | string> => {
    if (!renameTarget) return
    try {
      await renameCategory(renameTarget.id, name)
      setRenameTarget(null)
    } catch (err) {
      return err instanceof Error ? err.message : String(err)
    }
  }

  const handleConfirmDelete = async (): Promise<void> => {
    if (!deleteTarget) return
    const id = deleteTarget.id
    setDeleteTarget(null)
    try {
      await removeCategory(id)
      // 当前正在看这个分类则跳回探索
      if (view.kind === 'category' && view.id === id) {
        setView({ kind: 'explore' })
      }
    } catch (err) {
      console.error('deleteCategory failed:', err)
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={() => {
        setDragType(null)
        setActiveDrag(null)
        setHoveredDropCategoryId(null)
      }}
    >
      <div className="flex min-h-screen bg-background text-foreground">
        {/* 左侧边栏 */}
        <aside className="w-60 flex-shrink-0 flex flex-col border-r border-border bg-sidebar h-screen sticky top-0">
          <div className="h-16 flex items-center px-5 border-b border-border">
            <h1 className="text-xl font-bold text-primary">Serendip</h1>
          </div>

          <nav className="flex-1 py-4 overflow-y-auto">
            <NavItem
              icon={Compass}
              label="探索"
              active={view.kind === 'explore'}
              onClick={() => setView({ kind: 'explore' })}
            />
            <NavItem
              icon={Star}
              label="评审"
              active={view.kind === 'review'}
              onClick={() => setView({ kind: 'review' })}
            />
            <NavItem icon={Heart} label="喜欢" />

            <div className="mt-6">
              <div className="px-5 flex items-center justify-between py-1.5 text-xs font-semibold text-muted-foreground">
                <span>收藏分类</span>
                <button
                  className="hover:text-foreground transition-colors p-0.5 rounded hover:bg-muted"
                  title="新建分类"
                  onClick={() => setShowCreate(true)}
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>

              <CategoryList
                activeDragType={dragType}
                hoveredDropCategoryId={hoveredDropCategoryId}
                onRename={(c) => setRenameTarget(c)}
                onDelete={(c) => setDeleteTarget(c)}
              />
            </div>
          </nav>

          <div className="border-t border-border p-3 space-y-2">
            {stats && (
              <div className="text-xs text-muted-foreground space-y-0.5 px-2">
                <div>{stats.totalFiles.toLocaleString()} 个文件</div>
                <div>{stats.totalFolders.toLocaleString()} 个文件夹</div>
                <div>{stats.liked.toLocaleString()} 个喜欢</div>
              </div>
            )}
            <div className="flex justify-end">
              <button
                onClick={toggleTheme}
                className="p-2 rounded-lg hover:bg-muted transition-colors"
                title="切换主题"
              >
                {theme === 'light' ? (
                  <Moon className="w-5 h-5" />
                ) : (
                  <Sun className="w-5 h-5" />
                )}
              </button>
            </div>
          </div>
        </aside>

        {/* 右侧主区域 */}
        <main className="flex-1 flex flex-col min-w-0">
          <header className="h-16 flex-shrink-0 sticky top-0 z-10 flex items-center px-6 border-b border-border gap-4 bg-glass backdrop-blur-xl">
            <button
              onClick={handleSelectRoot}
              disabled={isScanning}
              className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-muted transition-colors disabled:opacity-50"
            >
              {rootPath ? '更换根目录' : '选择根目录'}
            </button>
            {rootPath && (
              <>
                <div className="text-sm text-muted-foreground truncate max-w-md">
                  {rootPath}
                </div>
                <button
                  onClick={handleRescan}
                  disabled={isScanning}
                  className="p-2 rounded-lg hover:bg-muted transition-colors disabled:opacity-50"
                  title="重新扫描"
                >
                  <RefreshCw
                    className={clsx('w-4 h-4', isScanning && 'animate-spin')}
                  />
                </button>
              </>
            )}

            {/* 三段探索程度（只在探索视图下显示，分类视图无意义） */}
            {view.kind === 'explore' && (
              <div className="flex-1 flex items-center justify-center gap-1">
                <SegmentButton
                  label="更多喜欢"
                  active={exploreMode === 'prefer'}
                  onClick={() => setExploreMode('prefer')}
                />
                <SegmentButton
                  label="均衡"
                  active={exploreMode === 'balanced'}
                  onClick={() => setExploreMode('balanced')}
                />
                <SegmentButton
                  label="更多探索"
                  active={exploreMode === 'explore'}
                  onClick={() => setExploreMode('explore')}
                />
              </div>
            )}

            {/* 缩略图尺寸切换 — 评审模式无 masonry，不需要此按钮 */}
            {rootPath && !isScanning && view.kind !== 'review' && (
              <button
                onClick={cycleGridSize}
                className="ml-auto flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-muted transition-colors"
                title="切换缩略图大小"
              >
                <LayoutGrid className="w-4 h-4" />
                <span className="w-3 text-center tabular-nums">
                  {GRID_SIZE_LABEL[gridSize]}
                </span>
              </button>
            )}
          </header>

          <div className="flex-1 bg-background">
            {isScanning ? (
              <ScanProgressPanel progress={scanProgress} />
            ) : !rootPath ? (
              <EmptyState onSelect={handleSelectRoot} />
            ) : view.kind === 'review' ? (
              <ReviewView />
            ) : view.kind === 'category' ? (
              <CategoryView key={view.id} categoryId={view.id} />
            ) : (
              <ExploreView />
            )}
          </div>
        </main>
      </div>

      {/* 新建分类 */}
      {showCreate && (
        <PromptDialog
          title="新建分类"
          hint="给这个分类起个名字"
          placeholder="例如：旅行、宠物、灵感板"
          confirmLabel="创建"
          onConfirm={handleCreateCategory}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {/* 重命名分类 */}
      {renameTarget && (
        <PromptDialog
          title="重命名分类"
          initialValue={renameTarget.name}
          confirmLabel="保存"
          onConfirm={handleRenameCategory}
          onCancel={() => setRenameTarget(null)}
        />
      )}

      {/* 删除分类二次确认 */}
      {deleteTarget && (
        <ConfirmDialog
          title="删除分类"
          message={
            <>
              确定要删除分类「<strong>{deleteTarget.name}</strong>」吗？
              <br />
              <span className="text-xs text-muted-foreground">
                包含的 {deleteTarget.itemCount} 项关联会一并清除，
                但原始文件不会被删除。
              </span>
            </>
          }
          confirmLabel="删除"
          danger
          onConfirm={handleConfirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {/* 拖拽浮层 — 中心吸附到鼠标，跟随光标 */}
      <DragOverlay dropAnimation={null} modifiers={[snapToCursor]}>
        {activeDrag?.type === 'media' ? (
          <MediaDragPreview item={activeDrag.item} count={activeDrag.count} />
        ) : activeDrag?.type === 'category' ? (
          <CategoryDragPreview name={activeDrag.name} />
        ) : null}
      </DragOverlay>

      {/* 跨分类投放：移动 / 复制 菜单（锚定在目标 tab 右侧） */}
      {dropMenu && (
        <ContextMenu
          x={dropMenu.x}
          y={dropMenu.y}
          items={[
            {
              key: 'move',
              label: `移动到此（${dropMenu.ids.length}）`,
              icon: FolderInput,
              onClick: () => void handleDropMove()
            },
            {
              key: 'copy',
              label: `复制到此（${dropMenu.ids.length}）`,
              icon: Copy,
              onClick: () => void handleDropCopy()
            }
          ]}
          onClose={() => setDropMenu(null)}
        />
      )}
    </DndContext>
  )
}

function SegmentButton({
  label,
  active,
  onClick
}: {
  label: string
  active: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'px-3 py-1.5 text-xs font-medium rounded-lg transition-colors',
        active
          ? 'bg-primary text-white'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted'
      )}
    >
      {label}
    </button>
  )
}

function EmptyState({ onSelect }: { onSelect: () => void }): React.JSX.Element {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center">
        <Compass className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
        <h2 className="text-xl font-semibold mb-2">欢迎使用 Serendip</h2>
        <p className="text-sm text-muted-foreground mb-6">
          选择一个根目录开始探索你的相册
        </p>
        <button
          onClick={onSelect}
          className="px-6 py-2.5 bg-primary text-white rounded-lg hover:bg-primary-hover transition-colors text-sm font-medium"
        >
          选择根目录
        </button>
      </div>
    </div>
  )
}

interface ScanProgressPanelProps {
  progress: {
    phase: string
    scanned: number
    total: number
    added: number
    removed: number
    updated: number
    currentPath?: string
  } | null
}

function ScanProgressPanel({ progress }: ScanProgressPanelProps): React.JSX.Element {
  const phaseLabels: Record<string, string> = {
    walking: '正在遍历目录…',
    diffing: '对比变更…',
    inserting: '写入数据库…',
    done: '完成'
  }

  const percent =
    progress && progress.total > 0
      ? Math.round((progress.scanned / progress.total) * 100)
      : 0

  return (
    <div className="h-full flex items-center justify-center">
      <div className="w-full max-w-lg px-8">
        <div className="flex items-center gap-3 mb-4">
          <Loader2 className="w-5 h-5 animate-spin text-primary" />
          <span className="text-sm font-medium">
            {progress ? phaseLabels[progress.phase] : '准备中…'}
          </span>
        </div>

        {progress && progress.phase !== 'walking' && progress.total > 0 && (
          <>
            <div className="h-2 bg-muted rounded-full overflow-hidden mb-2">
              <div
                className="h-full bg-primary transition-all duration-150"
                style={{ width: `${percent}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>
                {progress.scanned.toLocaleString()} /{' '}
                {progress.total.toLocaleString()}
              </span>
              <span>{percent}%</span>
            </div>
          </>
        )}

        {progress && (
          <div className="mt-6 grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-2xl font-bold text-primary">
                {progress.added.toLocaleString()}
              </div>
              <div className="text-xs text-muted-foreground mt-1">新增</div>
            </div>
            <div>
              <div className="text-2xl font-bold">
                {progress.updated.toLocaleString()}
              </div>
              <div className="text-xs text-muted-foreground mt-1">更新</div>
            </div>
            <div>
              <div className="text-2xl font-bold">
                {progress.removed.toLocaleString()}
              </div>
              <div className="text-xs text-muted-foreground mt-1">删除</div>
            </div>
          </div>
        )}

        {progress?.currentPath && (
          <div className="mt-6 text-xs text-muted-foreground truncate text-center">
            {progress.currentPath}
          </div>
        )}
      </div>
    </div>
  )
}

interface NavItemProps {
  icon: React.ElementType
  label: string
  active?: boolean
  onClick?: () => void
}

function NavItem({
  icon: Icon,
  label,
  active,
  onClick
}: NavItemProps): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'w-full flex items-center gap-3 px-5 py-2.5 text-sm font-medium transition-colors',
        active ? 'text-primary bg-primary/10' : 'text-foreground hover:bg-muted'
      )}
    >
      <Icon className="w-5 h-5 flex-shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  )
}

export default App
