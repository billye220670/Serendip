import { useEffect, useState, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
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
import { useDetailStore } from './stores/detail'
import { useLibraryStore } from './stores/library'
import { useCategoriesStore } from './stores/categories'
import { useSelectionStore } from './stores/selection'
import { ExploreView } from './views/Explore'
import { CategoryView } from './views/CategoryView'
import { ReviewView } from './views/Review'
import { LikedView } from './views/LikedView'
import { DetailView } from './views/Detail'
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
  FolderInput,
  Copy,
  FolderOpen,
  ChevronLeft,
  ChevronRight,
  SlidersHorizontal
} from 'lucide-react'
import clsx from 'clsx'
import type { Category } from '../../main/categories'
import type { MediaItem } from '../../main/recommender'
import type { GridSize } from './stores/ui'
import { IPC } from '../../main/ipc/contract'
import { ScrollContainerContext } from './lib/scrollContainer'

type DragType = 'category' | 'media' | null

/**
 * 自绘标题栏拖拽样式辅助 —— -webkit-app-region 不在标准 CSSProperties 类型里，
 * 用这两个常量统一加上 cast，避免每次都要写 `as React.CSSProperties`。
 */
const DRAGGABLE: React.CSSProperties = {
  WebkitAppRegion: 'drag'
} as unknown as React.CSSProperties
const NOT_DRAGGABLE: React.CSSProperties = {
  WebkitAppRegion: 'no-drag'
} as unknown as React.CSSProperties

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
  const { theme, exploreMode, setExploreMode } = useUIStore()
  const gridSize = useUIStore((s) => s.gridSize)
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const isDetailOpen = useDetailStore((s) => s.isOpen)
  const {
    rootPath,
    isScanning,
    scanProgress,
    stats,
    view,
    setView,
    loadCurrentRoot,
    startScan,
    bumpCategoryRefresh,
    reviewProgress
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

  // 主区滚动容器 —— MasonryGrid 通过 ScrollContainerProvider 拿到 element 本身，
  // 用容器的 scrollTop / clientHeight 替代默认的 window 滚动模型。
  // 用 state（不是 ref）：ref.current 变化不触发 re-render，孩子拿不到 element ready 的信号
  const [mainEl, setMainEl] = useState<HTMLElement | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    const handler = (_evt: unknown, isFs: boolean): void => setIsFullscreen(isFs)
    window.electron.ipcRenderer.on(IPC.FULLSCREEN_CHANGE, handler)
    return () => { window.electron.ipcRenderer.removeAllListeners(IPC.FULLSCREEN_CHANGE) }
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (isDetailOpen) return
      if (e.key !== 'Tab') return
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      e.preventDefault()
      toggleSidebar()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isDetailOpen, toggleSidebar])

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

  // ===== 标题栏：根据主题同步 WCO（系统自绘按钮）配色 =====
  // WCO 始终可见。详情页打开时不再隐藏按钮 —— 它由顶部 64px 留白让位（见 Detail.tsx）
  // 切主题时同步符号色与背景色，让 OS 自绘的 hover 高亮在亮/暗主题下都看得到
  useEffect(() => {
    void window.api.setTitleBarOverlay({ theme }).catch(() => {
      /* macOS 等不支持 WCO 的平台静默失败 */
    })
  }, [theme])

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
      <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">
        {/* 顶栏：横跨整个窗口宽度（含侧栏区域上方）。
            - 自绘标题栏：整条都启用 -webkit-app-region: drag 当作系统标题栏拖拽
            - 右侧预留 ~140px 给 Windows Controls Overlay 的最小化/最大化/关闭按钮
            - 内部按钮 / 输入需 no-drag 才可点
            - 不再 sticky —— 主区独立滚动，顶栏天然就是不滚的兄弟节点 */}
        <header
          className="h-16 flex-shrink-0 z-20 flex items-stretch border-b border-border"
          style={{ ...DRAGGABLE, backgroundColor: theme === 'dark' ? '#111009' : '#f5f4f1' }}
        >
          {/* 左：根目录、扫描、评审进度等业务态，贴左 */}
          <div className="flex-1 min-w-0 flex items-center px-4 gap-3">
            <button
              onClick={handleSelectRoot}
              disabled={isScanning}
              className="p-2 hover:opacity-60 transition-opacity disabled:opacity-30 flex-shrink-0"
              title={rootPath ? '更换根目录' : '选择根目录'}
              style={NOT_DRAGGABLE}
            >
              <FolderOpen className="w-5 h-5" />
            </button>
            {rootPath && (
              <>
                <div
                  className="text-sm text-muted-foreground truncate max-w-md"
                  style={NOT_DRAGGABLE}
                >
                  {rootPath}
                </div>
                <button
                  onClick={handleRescan}
                  disabled={isScanning}
                  className="p-2 rounded-lg hover:bg-muted transition-colors disabled:opacity-50 flex-shrink-0"
                  title="重新扫描"
                  style={NOT_DRAGGABLE}
                >
                  <RefreshCw
                    className={clsx('w-4 h-4', isScanning && 'animate-spin')}
                  />
                </button>
              </>
            )}

            {/* 评审进度 — 仅评审模式显示，靠中后部 */}
            {view.kind === 'review' && reviewProgress && (
              <span className="ml-auto text-sm text-muted-foreground flex-shrink-0">
                {reviewProgress.reviewed > 0
                  ? `已评审 ${reviewProgress.reviewed} 张`
                  : '开始评审'}
                {reviewProgress.pending > 0 && ` · 还有约 ${reviewProgress.pending} 张`}
              </span>
            )}
          </div>

          {/* 右：设置面板按钮 + 系统按钮预留区 */}
          <div
            className="flex items-center gap-1 pr-2 flex-shrink-0"
            style={NOT_DRAGGABLE}
          >
            <SettingsPopover
              showExploreMode={view.kind === 'explore'}
              showGridSize={view.kind !== 'review' && !!rootPath && !isScanning}
              exploreMode={exploreMode}
              setExploreMode={setExploreMode}
              gridSize={gridSize}
              theme={theme}
            />
            {/* 系统按钮（最小化/最大化/关闭）由 Electron WCO 在此处自绘，
                这里占位 ~140px 避免内容压到按钮上。
                macOS 走默认 hidden（信号灯在左上），不需要这块占位但 140px 留白也无碍。
                F11 全屏时 WCO 消失，占位收为 0 让按钮贴右 */}
            <div
              className="flex-shrink-0 transition-[width] duration-[250ms]"
              style={{ width: isFullscreen ? 0 : 140 }}
              aria-hidden
            />
          </div>
        </header>

        {/* 顶栏下方：侧栏 + 主区横排。row 固定高 = 视口剩余（顶栏不滚），
            主区独立 overflow-y:auto —— 滚动条只在主区出现，不冲到顶栏头上 */}
        <div className="flex flex-1 min-h-0">
          {/* 左侧边栏：row 已经限制了高度，sidebar 直接撑满即可，无需 sticky */}
          <aside
            className="flex-shrink-0 flex flex-col bg-sidebar h-full overflow-hidden transition-[width] duration-[250ms] ease-in-out"
            style={{ width: sidebarCollapsed ? 70 : 240 }}
          >
            {/* 侧栏顶部：品牌 + 折叠按钮，高度与顶栏齐 */}
            <div
              className={clsx(
                'h-16 flex-shrink-0 flex items-center',
                sidebarCollapsed ? 'justify-center px-2' : 'justify-between px-4'
              )}
            >
              {!sidebarCollapsed && (
                <h1 className="text-xl font-bold text-primary truncate">Serendip</h1>
              )}
              <button
                onClick={toggleSidebar}
                className="p-1.5 rounded-lg hover:bg-sidebar-hover transition-colors text-muted-foreground hover:text-foreground flex-shrink-0"
                title={sidebarCollapsed ? '展开侧栏' : '折叠侧栏'}
              >
                {sidebarCollapsed ? (
                  <ChevronRight className="w-4 h-4" />
                ) : (
                  <ChevronLeft className="w-4 h-4" />
                )}
              </button>
            </div>
            <nav className="flex-1 pt-2 pb-4 overflow-y-auto overflow-x-hidden">
              <NavItem
                icon={Compass}
                label="探索"
                active={view.kind === 'explore'}
                collapsed={sidebarCollapsed}
                onClick={() => setView({ kind: 'explore' })}
              />
              <NavItem
                icon={Star}
                label="评审"
                active={view.kind === 'review'}
                collapsed={sidebarCollapsed}
                onClick={() => setView({ kind: 'review' })}
              />
              <NavItem
                icon={Heart}
                label="喜欢"
                active={view.kind === 'liked'}
                collapsed={sidebarCollapsed}
                badge={!sidebarCollapsed && stats?.liked ? stats.liked : undefined}
                onClick={() => setView({ kind: 'liked' })}
              />

              <div className="mt-6">
                {!sidebarCollapsed && (
                  <div className="px-5 flex items-center justify-between py-2 text-xs font-semibold text-muted-foreground">
                    <span>收藏分类</span>
                    <button
                      className="hover:text-foreground transition-colors p-0.5 rounded hover:bg-sidebar-hover"
                      title="新建分类"
                      onClick={() => setShowCreate(true)}
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                )}
                {sidebarCollapsed && (
                  <div className="flex justify-center py-1.5">
                    <button
                      className="p-1 hover:text-foreground text-muted-foreground hover:bg-sidebar-hover rounded transition-colors"
                      title="新建分类"
                      onClick={() => setShowCreate(true)}
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                )}

                <CategoryList
                  activeDragType={dragType}
                  hoveredDropCategoryId={hoveredDropCategoryId}
                  collapsed={sidebarCollapsed}
                  onRename={(c) => setRenameTarget(c)}
                  onDelete={(c) => setDeleteTarget(c)}
                />
              </div>
            </nav>
          </aside>

          {/* 右侧主区域：独立滚动容器。MasonryGrid 通过 ScrollContainerProvider 拿到此 ref，
              把 masonic 的滚动监听从 window 切到这里。
              relative 让内部 offsetParent 链停在这里，便于 MasonryGrid 计算 grid 在
              本容器内的 offsetTop（瀑布流 padding 等需要从 scrollTop 中扣掉） */}
          <main
            ref={setMainEl}
            className={clsx(
              'flex-1 min-w-0 overflow-y-auto overflow-x-clip relative',
              theme === 'light' ? 'bg-[#dbd8d6]' : 'bg-background'
            )}
          >
            <ScrollContainerContext.Provider value={mainEl}>
              {/* min-h-full 让 EmptyState / ScanProgressPanel 用 h-full 仍能居中
                  （main 是 overflow-y:auto，子节点默认按内容撑高，没有 flex 基线）
                  评审模式改为 h-full：ReviewView 依赖 h-full 让绝对定位层正确撑开 */}
              <div className={view.kind === 'review' ? 'h-full' : 'min-h-full'}>
                {isScanning ? (
                  <ScanProgressPanel progress={scanProgress} />
                ) : !rootPath ? (
                  <EmptyState onSelect={handleSelectRoot} />
                ) : view.kind === 'review' ? (
                  <ReviewView />
                ) : view.kind === 'liked' ? (
                  <LikedView />
                ) : view.kind === 'category' ? (
                  <CategoryView key={view.id} categoryId={view.id} />
                ) : (
                  <ExploreView />
                )}
              </div>
            </ScrollContainerContext.Provider>
          </main>
        </div>
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
      {/* 详情页沉浸 overlay — fixed inset-0 z-50，底层瀑布流不销毁 */}
      <DetailView />
    </DndContext>
  )
}

/**
 * 顶栏右上角的设置面板：把缩略图大小（小/中/大）+ 探索程度三段切换收纳到一个下拉。
 *
 * 触发器是一个 SlidersHorizontal 图标按钮；点击切换面板。
 * 面板锚定在按钮下方右侧，固定定位（避开顶栏边界），点击外部关闭。
 * 渲染条件由父级控制（`showExploreMode` / `showGridSize` 决定面板内显示哪些块）。
 */
function SettingsPopover({
  showExploreMode,
  showGridSize,
  exploreMode,
  setExploreMode,
  gridSize,
  theme
}: {
  showExploreMode: boolean
  showGridSize: boolean
  exploreMode: 'prefer' | 'balanced' | 'explore'
  setExploreMode: (m: 'prefer' | 'balanced' | 'explore') => void
  gridSize: GridSize
  theme: 'light' | 'dark'
}): React.JSX.Element {
  const cycleGridSize = useUIStore((s) => s.cycleGridSize)
  const toggleTheme = useUIStore((s) => s.toggleTheme)
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null)

  const EXPLORE_ORDER = ['prefer', 'balanced', 'explore'] as const
  const EXPLORE_LABEL = { prefer: '更多喜欢', balanced: '均衡', explore: '更多探索' } as const
  const cycleExplore = (): void => {
    const next = EXPLORE_ORDER[(EXPLORE_ORDER.indexOf(exploreMode) + 1) % 3]
    setExploreMode(next)
  }

  // 打开时计算面板位置（锚到按钮下方，靠右对齐）
  useEffect(() => {
    if (!open) return
    const r = btnRef.current?.getBoundingClientRect()
    if (r) setAnchor({ top: r.bottom + 6, right: window.innerWidth - r.right })

    // 点外关闭
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (panelRef.current?.contains(t)) return
      if (btnRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          'p-2 rounded-lg transition-colors',
          open
            ? 'bg-muted text-foreground'
            : 'hover:bg-muted text-muted-foreground hover:text-foreground'
        )}
        title="显示设置"
        aria-expanded={open}
      >
        <SlidersHorizontal className="w-4 h-4" />
      </button>
      {open &&
        anchor &&
        createPortal(
          <div
            ref={panelRef}
            className="fixed z-[150] rounded-xl border border-border bg-glass backdrop-blur-xl shadow-lg shadow-black/20 p-4 flex flex-col gap-3"
            style={{ top: anchor.top, right: anchor.right }}
          >
            {showGridSize && (
              <div className="flex items-center gap-4">
                <span className="text-xs text-muted-foreground flex-1">缩略图</span>
                <button
                  onClick={cycleGridSize}
                  className="w-20 py-2 rounded-lg text-xs font-medium bg-muted text-foreground hover:bg-border transition-colors text-center"
                >
                  {GRID_SIZE_LABEL[gridSize]}
                </button>
              </div>
            )}
            {showExploreMode && (
              <div className="flex items-center gap-4">
                <span className="text-xs text-muted-foreground flex-1">探索度</span>
                <button
                  onClick={cycleExplore}
                  className="w-20 py-2 rounded-lg text-xs font-medium bg-muted text-foreground hover:bg-border transition-colors text-center"
                >
                  {EXPLORE_LABEL[exploreMode]}
                </button>
              </div>
            )}
            <div className="flex items-center gap-4">
              <span className="text-xs text-muted-foreground flex-1">外观</span>
              <button
                onClick={toggleTheme}
                className="w-20 py-2 rounded-lg text-xs font-medium bg-muted text-foreground hover:bg-border transition-colors flex items-center justify-center gap-1.5"
              >
                {theme === 'light' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
                {theme === 'light' ? '亮色' : '暗色'}
              </button>
            </div>
          </div>,
          document.body
        )}
    </>
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
  collapsed?: boolean
  /** 展开态右侧数字徽章（折叠态不显示）*/
  badge?: number
  onClick?: () => void
}

function NavItem({
  icon: Icon,
  label,
  active,
  collapsed,
  badge,
  onClick
}: NavItemProps): React.JSX.Element {
  const [showTooltip, setShowTooltip] = useState(false)
  const [tooltipY, setTooltipY] = useState(0)
  const btnRef = useRef<HTMLButtonElement>(null)

  const handleMouseEnter = (): void => {
    if (!collapsed) return
    const rect = btnRef.current?.getBoundingClientRect()
    if (rect) setTooltipY(rect.top)
    setShowTooltip(true)
  }

  return (
    <div className="relative">
      <button
        ref={btnRef}
        onClick={onClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={() => setShowTooltip(false)}
        className={clsx(
          'w-full flex items-center gap-3 py-3 text-sm font-medium transition-colors',
          collapsed ? 'justify-center px-0' : 'px-5',
          active ? 'text-primary' : 'text-foreground hover:bg-sidebar-hover'
        )}
      >
        <Icon className="w-5 h-5 flex-shrink-0" />
        {!collapsed && <span className="truncate flex-1 text-left">{label}</span>}
        {!collapsed && badge !== undefined && (
          <span className="text-xs text-muted-foreground tabular-nums">{badge.toLocaleString()}</span>
        )}
      </button>

      {/* 折叠态 tooltip — portal 到 body，绕开 aside overflow:hidden 的 stacking context */}
      {collapsed && showTooltip && createPortal(
        <div
          className="fixed z-[200] pointer-events-none"
          style={{ left: 78, top: tooltipY }}
        >
          <div className="bg-glass backdrop-blur-xl border border-border text-foreground text-xs px-2.5 py-1.5 rounded-lg shadow-lg whitespace-nowrap">
            {label}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

export default App
