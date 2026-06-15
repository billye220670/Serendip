import { useEffect, useRef, useState, useCallback } from 'react'
import { Check, Plus, Search, X } from 'lucide-react'
import clsx from 'clsx'
import type { Category } from '../../../main/categories'

interface Props {
  fileId: number
  categories: Category[]
  memberIds: Set<number>
  onToggle: (categoryId: number) => Promise<void>
  onCreate: (name: string) => Promise<void>
  onClose: () => void
}

/**
 * 分类搜索面板 (h + i)：锚定在 # 按钮上方的固定高度卡片。
 *
 * - 始终按字母（中文拼音）排序，check/uncheck 不改变顺序
 * - 搜索框自动聚焦；输入即过滤
 * - ↑↓ 选择，回车切换归属
 * - 搜不到时显示「新建」选项；回车新建并归入
 * - 面板内滚轮只滚列表，不穿透到底层切图
 * - Esc 关闭（Detail 的键盘处理器负责传递）
 */
export function CategorySearchPanel({
  fileId,
  categories,
  memberIds,
  onToggle,
  onCreate,
  onClose,
}: Props): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLUListElement | null>(null)

  // 自动聚焦
  useEffect(() => {
    const raf = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(raf)
  }, [])

  // 始终按字母排序（zh locale = 中文拼音），从不按归属状态重排
  const sorted = [...categories].sort((a, b) => a.name.localeCompare(b.name, 'zh'))

  const q = query.trim().toLowerCase()
  const filtered = q
    ? sorted.filter((c) => c.name.toLowerCase().includes(q))
    : sorted

  const trimmed = query.trim()
  const exactExists = categories.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())
  const showCreate = trimmed.length > 0 && !exactExists

  const totalCount = filtered.length + (showCreate ? 1 : 0)

  useEffect(() => { setActiveIndex(0) }, [query])

  // 滚动到活跃项
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const item = list.children[activeIndex] as HTMLElement | undefined
    item?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const handleToggle = useCallback(
    async (categoryId: number) => { await onToggle(categoryId) },
    [onToggle]
  )

  const handleCreate = useCallback(async () => {
    if (!trimmed) return
    await onCreate(trimmed)
    setQuery('')
  }, [trimmed, onCreate])

  const handleKeyDown = useCallback(
    async (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return }
      if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, totalCount - 1)); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)); return }
      if (e.key === 'Enter') {
        e.preventDefault()
        if (showCreate && activeIndex === filtered.length) { await handleCreate(); return }
        const target = filtered[activeIndex]
        if (target) await handleToggle(target.id)
      }
    },
    [activeIndex, filtered, showCreate, handleCreate, handleToggle, onClose, totalCount]
  )

  // fileId 变化（切图）自动关闭，作为兜底保障
  const prevIdRef = useRef(fileId)
  useEffect(() => {
    if (prevIdRef.current !== fileId) { prevIdRef.current = fileId; onClose() }
  }, [fileId, onClose])

  return (
    // 面板卡片：绝对定位由父节点的 relative 确定（bottom-full = 锚定在 # 按钮上方）
    <div
      className="absolute bottom-full mb-2 left-0 w-72 flex flex-col rounded-2xl overflow-hidden shadow-2xl ring-1 ring-border bg-secondary"
      style={{ height: 380 }}
      // 面板内滚轮只滚列表，阻止穿透到底层切图
      onWheel={(e) => e.stopPropagation()}
    >
      {/* 搜索栏 */}
      <div className="px-4 py-4 flex-shrink-0">
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-background">
          <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { void handleKeyDown(e) }}
            placeholder="搜索或新建分类…"
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none caret-primary"
          />
          {query && (
            <button
              onPointerDown={(e) => { e.preventDefault(); setQuery('') }}
              className="text-muted-foreground hover:text-foreground transition-colors focus:outline-none"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* 列表 */}
      <ul ref={listRef} className="flex-1 overflow-y-auto py-1.5">
        {filtered.map((cat) => {
          const isMember = memberIds.has(cat.id)
          return (
            <li key={cat.id}>
              <button
                onPointerDown={(e) => { e.preventDefault(); void handleToggle(cat.id) }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors text-foreground/80 hover:bg-foreground/[0.05] hover:text-foreground"
              >
                <span
                  className={clsx(
                    'flex-shrink-0 w-4 h-4 rounded border transition-colors flex items-center justify-center',
                    isMember ? 'bg-primary border-primary' : 'border-border'
                  )}
                >
                  {isMember && <Check className="w-3 h-3 text-white" strokeWidth={2.5} />}
                </span>
                <span className="flex-1 truncate">{cat.name}</span>
                <span className="text-xs text-muted-foreground tabular-nums flex-shrink-0">{cat.itemCount}</span>
              </button>
            </li>
          )
        })}

        {showCreate && (
          <li>
            <button
              onPointerDown={(e) => { e.preventDefault(); void handleCreate() }}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors text-foreground/60 hover:bg-foreground/[0.05] hover:text-foreground"
            >
              <span className="flex-shrink-0 w-4 h-4 rounded border border-dashed border-border flex items-center justify-center">
                <Plus className="w-3 h-3" />
              </span>
              <span className="flex-1 truncate">
                新建「<span className="text-foreground font-medium">{trimmed}</span>」
              </span>
            </button>
          </li>
        )}

        {filtered.length === 0 && !showCreate && (
          <li className="px-4 py-4 text-sm text-muted-foreground text-center">暂无分类</li>
        )}
      </ul>
    </div>
  )
}
