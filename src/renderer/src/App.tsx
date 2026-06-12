import { useEffect } from 'react'
import { useUIStore } from './stores/ui'
import { useLibraryStore } from './stores/library'
import { ExploreView } from './views/Explore'
import {
  Sun,
  Moon,
  Compass,
  Star,
  Heart,
  Loader2,
  RefreshCw
} from 'lucide-react'
import clsx from 'clsx'

function App(): React.JSX.Element {
  const { theme, toggleTheme, exploreMode, setExploreMode } = useUIStore()
  const {
    rootPath,
    isScanning,
    scanProgress,
    stats,
    loadCurrentRoot,
    startScan
  } = useLibraryStore()

  useEffect(() => {
    loadCurrentRoot()
  }, [loadCurrentRoot])

  const handleSelectRoot = async (): Promise<void> => {
    const path = await window.api.selectRootDirectory()
    if (path) {
      await startScan(path)
    }
  }

  const handleRescan = async (): Promise<void> => {
    if (rootPath) await startScan(rootPath)
  }

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* 左侧边栏 */}
      <aside className="w-60 flex-shrink-0 flex flex-col border-r border-border bg-sidebar h-screen sticky top-0">
        <div className="h-16 flex items-center px-5 border-b border-border">
          <h1 className="text-xl font-bold text-primary">Serendip</h1>
        </div>

        <nav className="flex-1 py-4 overflow-y-auto">
          <NavItem icon={Compass} label="探索" active />
          <NavItem icon={Star} label="评审" />
          <NavItem icon={Heart} label="喜欢" />

          <div className="mt-6 px-3">
            <div className="flex items-center justify-between px-2 py-1.5 text-xs font-semibold text-muted-foreground">
              <span>收藏分类</span>
              <button className="hover:text-foreground transition-colors">
                <span className="text-base">+</span>
              </button>
            </div>
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
        <header className="h-16 flex-shrink-0 sticky top-0 z-10 flex items-center px-6 border-b border-border gap-4 bg-background/95 backdrop-blur">
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

          {/* 三段探索程度 */}
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
        </header>

        <div className="flex-1 bg-background">
          {isScanning ? (
            <ScanProgressPanel progress={scanProgress} />
          ) : !rootPath ? (
            <EmptyState onSelect={handleSelectRoot} />
          ) : (
            <ExploreView />
          )}
        </div>
      </main>
    </div>
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
}

function NavItem({
  icon: Icon,
  label,
  active
}: NavItemProps): React.JSX.Element {
  return (
    <button
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
