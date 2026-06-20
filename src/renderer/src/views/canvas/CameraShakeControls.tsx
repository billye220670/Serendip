import { useEffect, useRef, useState } from 'react'
import { Settings, X } from 'lucide-react'
import { useCameraShakeStore } from '../../stores/cameraShake'
import { Tooltip } from '../../components/Tooltip'
import { CameraShakePanel } from './CameraShakePanel'

/**
 * 摄影机手摇展开控件（始终渲染；总开关关闭时整体灰化不可用）：
 * - 预设 chip：固定宽度；滚轮在预设间循环切换（阻断滚轮穿透到画布缩放）；点击向上弹出预设列表
 * - 设置齿轮：状态按钮，点击 toggle 参数面板（保持展开，不随开关收起）
 *
 * `onPopoverChange`：列表或面板的展开态变化时回调（锁定模式浮条用它在弹层打开时保持可见）。
 */
export function CameraShakeControls({
  disabled = false,
  onPopoverChange
}: {
  disabled?: boolean
  onPopoverChange?: (open: boolean) => void
}): React.JSX.Element {
  const presetOrder = useCameraShakeStore((s) => s.presetOrder)
  const activePreset = useCameraShakeStore((s) => s.activePreset)
  const applyPreset = useCameraShakeStore((s) => s.applyPreset)
  const deletePreset = useCameraShakeStore((s) => s.deletePreset)
  const cyclePreset = useCameraShakeStore((s) => s.cyclePreset)

  const [listOpen, setListOpen] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const chipRef = useRef<HTMLButtonElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const gearRef = useRef<HTMLButtonElement | null>(null)

  // 禁用时弹层一律视为收起（不卸载状态，避免 effect 里同步 setState）
  const listShown = listOpen && !disabled
  const panelShown = panelOpen && !disabled

  // 弹层展开态变化 → 通知宿主
  useEffect(() => {
    onPopoverChange?.(listShown || panelShown)
  }, [listShown, panelShown, onPopoverChange])

  const label = presetOrder.length === 0 ? '无可用预设' : (activePreset ?? '自定义')

  // 滚轮在预设间循环 —— 用原生非 passive 监听，stopPropagation 阻止穿透到画布 wheel（缩放）
  useEffect(() => {
    const el = chipRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (disabled) return
      cyclePreset(e.deltaY > 0 ? 1 : -1)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [cyclePreset, disabled])

  // 列表外点关闭
  useEffect(() => {
    if (!listShown) return
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (listRef.current?.contains(t) || chipRef.current?.contains(t)) return
      setListOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [listShown])

  return (
    <>
      {/* 预设 chip（固定宽度，避免滚轮切换时长度跳动） */}
      <div className="relative">
        <Tooltip text={disabled ? undefined : '预设（滚轮快速切换）'} side="top">
          <button
            ref={chipRef}
            onClick={() => !disabled && setListOpen((v) => !v)}
            disabled={disabled}
            className={`w-24 px-2 py-1 rounded-lg text-[11px] font-medium truncate text-center transition-colors ${
              disabled
                ? 'text-muted-foreground/40 cursor-not-allowed'
                : listShown
                  ? 'bg-sidebar-hover text-foreground'
                  : 'text-muted-foreground hover:bg-sidebar-hover hover:text-foreground'
            }`}
          >
            {label}
          </button>
        </Tooltip>

        {/* 预设列表（向上弹出、右对齐唤出按钮，实色） */}
        {listShown && (
          <div
            ref={listRef}
            className="absolute bottom-full mb-2 right-0 w-40 max-h-64 overflow-y-auto rounded-xl border border-border bg-sidebar shadow-lg shadow-black/20 p-1.5 flex flex-col gap-0.5"
          >
            {presetOrder.length === 0 ? (
              <div className="px-3 py-2 text-[11px] text-muted-foreground">暂无预设，点设置新建</div>
            ) : (
              presetOrder.map((name) => (
                <div
                  key={name}
                  className={`group flex items-center gap-1 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                    name === activePreset
                      ? 'bg-primary/15 text-foreground'
                      : 'text-muted-foreground hover:bg-sidebar-hover hover:text-foreground'
                  }`}
                  onClick={() => {
                    applyPreset(name)
                    setListOpen(false)
                  }}
                >
                  <span className="flex-1 truncate text-[11px]">{name}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      deletePreset(name)
                    }}
                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-muted-foreground hover:text-red-500 transition-all"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* 设置齿轮（状态按钮，激活态主题高亮） */}
      <div className="relative">
        <Tooltip text={disabled ? undefined : '手摇参数设置'} side="top">
          <button
            ref={gearRef}
            onClick={() => !disabled && setPanelOpen((v) => !v)}
            disabled={disabled}
            className={`p-1.5 rounded-lg transition-colors ${
              disabled
                ? 'text-muted-foreground/40 cursor-not-allowed'
                : panelShown
                  ? 'text-primary hover:bg-sidebar-hover'
                  : 'text-muted-foreground hover:bg-sidebar-hover hover:text-foreground'
            }`}
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
        </Tooltip>
        {panelShown && (
          <CameraShakePanel triggerRef={gearRef} onClose={() => setPanelOpen(false)} />
        )}
      </div>
    </>
  )
}
