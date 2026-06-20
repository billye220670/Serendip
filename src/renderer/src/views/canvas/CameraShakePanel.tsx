import { Fragment, useEffect, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { useCameraShakeStore } from '../../stores/cameraShake'
import type { ShakeParams } from '../../lib/cameraShake'

/**
 * 档位定义：每个参数不再是连续滑杆，而是吸附到若干「档位」。
 * 滑块取值 = 档位下标（0 起，0 通常为最弱/关）；右侧显示该档位数字。
 * tiers 是每档对应的真实参数值，引擎语义不变。
 */
interface TierDef {
  key: keyof ShakeParams
  label: string
  tiers: number[]
}

// 摇摆（持续游移）—— 每项 5 档，0 档为关/最弱
const NOISE_TIERS: TierDef[] = [
  { key: 'noisePosAmp', label: '晃动幅度', tiers: [0, 8, 18, 35, 70] },
  { key: 'noisePosFreq', label: '晃动速度', tiers: [0.15, 0.3, 0.6, 1.2, 2.2] },
  { key: 'noiseRotAmp', label: '倾斜幅度', tiers: [0, 0.4, 1, 2.5, 5] },
  { key: 'noiseRotFreq', label: '倾斜速度', tiers: [0.1, 0.25, 0.5, 1, 1.8] },
  { key: 'noiseZoomAmp', label: '呼吸幅度', tiers: [0, 0.006, 0.015, 0.04, 0.09] },
  { key: 'noiseZoomFreq', label: '呼吸速度', tiers: [0.1, 0.2, 0.4, 0.8, 1.4] }
]

// 脉冲（间歇抖动）
const PULSE_TIERS: TierDef[] = [
  { key: 'pulsePosAmp', label: '撞动力度', tiers: [0, 25, 60, 120, 220] },
  { key: 'pulseRotAmp', label: '甩动力度', tiers: [0, 0.8, 2, 5, 10] },
  { key: 'pulseZoomAmp', label: '顿挫力度', tiers: [0, 0.01, 0.025, 0.06, 0.15] },
  // 间隔越长抖得越少 —— 档位由频繁到稀疏
  { key: 'pulseInterval', label: '抖动频率', tiers: [1, 2.5, 4.5, 7, 10] },
  { key: 'pulseIntervalJitter', label: '节奏随机', tiers: [0, 0.5, 1.5, 3, 5] },
  { key: 'pulseDecay', label: '余震拖尾', tiers: [0.12, 0.25, 0.5, 1, 1.8] },
  { key: 'pulseWobble', label: '回弹晃动', tiers: [0, 3, 7, 13, 20] }
]

const MASTER_TIER: TierDef = {
  key: 'masterIntensity',
  label: '总强度',
  tiers: [0, 0.5, 1, 1.5, 2]
}

/** 找出最接近当前值的档位下标（持久化/预设值可能不正好落在某档） */
function nearestTier(tiers: number[], v: number): number {
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < tiers.length; i++) {
    const d = Math.abs(tiers[i] - v)
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

/**
 * 档位条 —— 一格一格的分段样式（类似音量条）。
 * 点亮格数 = 当前档位 + 1；可点击某格或在条上拖动选档。
 */
function TierBar({
  count,
  index,
  disabled,
  onChange
}: {
  count: number
  index: number
  disabled: boolean
  onChange: (i: number) => void
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)
  const pick = (clientX: number): void => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const ratio = (clientX - r.left) / r.width
    const i = Math.max(0, Math.min(count - 1, Math.floor(ratio * count)))
    onChange(i)
  }
  return (
    <div
      ref={ref}
      className={`flex-1 flex items-center gap-1 ${
        disabled ? 'opacity-40 pointer-events-none' : 'cursor-pointer'
      }`}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        pick(e.clientX)
      }}
      onPointerMove={(e) => {
        if (e.buttons === 1) pick(e.clientX)
      }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <span
          key={i}
          className={`flex-1 h-2.5 rounded-sm transition-colors ${
            i <= index ? 'bg-primary' : 'bg-border'
          }`}
        />
      ))}
    </div>
  )
}

/** 小型开关组件（实色，主题高亮） */
function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }): React.JSX.Element {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      className={`relative w-7 h-4 rounded-full transition-colors shrink-0 ${
        on ? 'bg-primary' : 'bg-border'
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
          on ? 'translate-x-3' : 'translate-x-0'
        }`}
      />
    </button>
  )
}

interface Props {
  onClose: () => void
  /** 唤出按钮的 ref —— 外点关闭时忽略它，避免「关了又被按钮 onClick 开回来」 */
  triggerRef?: React.RefObject<HTMLElement | null>
}

export function CameraShakePanel({ onClose, triggerRef }: Props): React.JSX.Element {
  const params = useCameraShakeStore((s) => s.params)
  const setParam = useCameraShakeStore((s) => s.setParam)
  const createPreset = useCameraShakeStore((s) => s.createPreset)

  const [tab, setTab] = useState<'noise' | 'pulse'>('noise')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)

  // 外点关闭 + Esc 关闭
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (panelRef.current?.contains(t)) return
      if (triggerRef?.current?.contains(t)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    // 延后注册，避免触发打开的那次点击立刻关闭
    const id = setTimeout(() => window.addEventListener('mousedown', onDown), 0)
    window.addEventListener('keydown', onKey, true)
    return () => {
      clearTimeout(id)
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [onClose, triggerRef])

  const submitPreset = (): void => {
    const err = createPreset(name)
    if (err) {
      setError(err)
      return
    }
    setName('')
    setError(null)
    // 创建成功后自动关闭面板
    onClose()
  }

  const tiers = tab === 'noise' ? NOISE_TIERS : PULSE_TIERS
  const groupEnabled = tab === 'noise' ? params.noiseEnabled : params.pulseEnabled

  const renderTier = (def: TierDef, enabled: boolean): React.JSX.Element => {
    const value = params[def.key] as number
    const idx = nearestTier(def.tiers, value)
    return (
      <div key={def.key} className="flex items-center gap-2 py-1">
        <span className="text-[11px] text-muted-foreground w-16 shrink-0">{def.label}</span>
        <TierBar
          count={def.tiers.length}
          index={idx}
          disabled={!enabled}
          onChange={(i) => setParam(def.key, def.tiers[i])}
        />
      </div>
    )
  }

  return (
    <div
      ref={panelRef}
      className="absolute bottom-full right-0 mb-2 w-[320px] rounded-xl border border-border bg-sidebar shadow-lg shadow-black/25 p-3.5 flex flex-col gap-3.5 select-none"
    >
      {/* 新建预设：输入框 + ＋ */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={name}
            placeholder="输入预设名称"
            maxLength={6}
            onChange={(e) => {
              setName(e.target.value)
              if (error) setError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                submitPreset()
              }
            }}
            className="flex-1 min-w-0 px-2.5 py-1.5 text-xs rounded-lg border border-border bg-background outline-none focus:border-primary transition-colors"
          />
          <button
            onClick={submitPreset}
            title="保存为预设"
            className="p-1.5 rounded-lg bg-primary text-white hover:bg-primary-hover transition-colors shrink-0"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
        {error && <span className="text-[11px] text-red-500 px-0.5">{error}</span>}
      </div>

      {/* 两个 tab：前置开关 + 标签（内容居左，按钮仍均摊整行）。上下细分割线 + 中间竖分割线区隔 */}
      <div className="flex items-center gap-1 mt-1 pb-3.5 border-b border-border">
        {(['noise', 'pulse'] as const).map((key) => {
          const on = key === 'noise' ? params.noiseEnabled : params.pulseEnabled
          const label = key === 'noise' ? '摇摆' : '脉冲'
          return (
            <Fragment key={key}>
              <button
                onClick={() => setTab(key)}
                className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-medium transition-colors flex-1 justify-start ${
                  tab === key
                    ? 'bg-sidebar-hover text-foreground'
                    : 'text-muted-foreground hover:bg-sidebar-hover/60'
                }`}
              >
                <Toggle
                  on={on}
                  onToggle={() => setParam(key === 'noise' ? 'noiseEnabled' : 'pulseEnabled', !on)}
                />
                {label}
              </button>
              {key === 'noise' && <div className="w-px h-5 bg-border shrink-0" />}
            </Fragment>
          )
        })}
      </div>

      {/* 当前 tab 的档位 */}
      <div className="flex flex-col gap-0.5">{tiers.map((def) => renderTier(def, groupEnabled))}</div>

      {/* 分割线 + 总强度（不受分组开关影响） */}
      <div className="pt-3 border-t border-border">{renderTier(MASTER_TIER, true)}</div>
    </div>
  )
}
