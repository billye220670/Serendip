import { useEffect, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { useCameraShakeStore } from '../../stores/cameraShake'
import type { ShakeParams } from '../../lib/cameraShake'

interface SliderDef {
  key: keyof ShakeParams
  label: string
  min: number
  max: number
  step: number
  unit?: string
}

const NOISE_SLIDERS: SliderDef[] = [
  { key: 'noisePosAmp', label: '位移振幅', min: 0, max: 200, step: 1, unit: 'px' },
  { key: 'noisePosFreq', label: '位移频率', min: 0.02, max: 4, step: 0.01, unit: 'Hz' },
  { key: 'noiseRotAmp', label: '旋转振幅', min: 0, max: 15, step: 0.1, unit: '°' },
  { key: 'noiseRotFreq', label: '旋转频率', min: 0.02, max: 3, step: 0.01, unit: 'Hz' },
  { key: 'noiseZoomAmp', label: '缩放振幅', min: 0, max: 0.3, step: 0.005 },
  { key: 'noiseZoomFreq', label: '缩放频率', min: 0.02, max: 2, step: 0.01, unit: 'Hz' }
]

const PULSE_SLIDERS: SliderDef[] = [
  { key: 'pulsePosAmp', label: '位移峰值', min: 0, max: 300, step: 1, unit: 'px' },
  { key: 'pulseRotAmp', label: '旋转峰值', min: 0, max: 20, step: 0.1, unit: '°' },
  { key: 'pulseZoomAmp', label: '缩放峰值', min: 0, max: 0.4, step: 0.005 },
  { key: 'pulseInterval', label: '基础间隔', min: 0.2, max: 12, step: 0.1, unit: 's' },
  { key: 'pulseIntervalJitter', label: '间隔随机±', min: 0, max: 6, step: 0.1, unit: 's' },
  { key: 'pulseDecay', label: '衰减时长', min: 0.05, max: 2, step: 0.01, unit: 's' },
  { key: 'pulseWobble', label: '回弹频率', min: 0, max: 25, step: 0.5, unit: 'Hz' }
]

function decimalsOf(step: number): number {
  if (Number.isInteger(step)) return 0
  return (step.toString().split('.')[1] ?? '').length
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

  const sliders = tab === 'noise' ? NOISE_SLIDERS : PULSE_SLIDERS
  const groupEnabled = tab === 'noise' ? params.noiseEnabled : params.pulseEnabled

  const renderSlider = (def: SliderDef): React.JSX.Element => {
    const value = params[def.key] as number
    const dec = decimalsOf(def.step)
    return (
      <div key={def.key} className="flex items-center gap-2 py-0.5">
        <span className="text-[11px] text-muted-foreground w-16 shrink-0">{def.label}</span>
        <input
          type="range"
          min={def.min}
          max={def.max}
          step={def.step}
          value={value}
          disabled={!groupEnabled}
          onChange={(e) => setParam(def.key, Number(e.target.value))}
          className="flex-1 h-1 accent-primary cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        />
        <span className="text-[11px] font-mono text-foreground w-14 shrink-0 text-right tabular-nums">
          {value.toFixed(dec)}
          {def.unit ?? ''}
        </span>
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

      {/* 两个 tab：前置开关 + 标签（内容居左，按钮仍均摊整行） */}
      <div className="flex items-center gap-1">
        {(['noise', 'pulse'] as const).map((key) => {
          const on = key === 'noise' ? params.noiseEnabled : params.pulseEnabled
          const label = key === 'noise' ? '摇摆' : '脉冲'
          return (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors flex-1 justify-start ${
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
          )
        })}
      </div>

      {/* 当前 tab 的参数 */}
      <div className="flex flex-col gap-1">{sliders.map(renderSlider)}</div>

      {/* 分割线 + 总强度 */}
      <div className="flex flex-col gap-1.5 pt-3 border-t border-border">
        {renderAlwaysSlider(
          { key: 'masterIntensity', label: '总强度', min: 0, max: 2, step: 0.05 },
          params,
          setParam
        )}
      </div>
    </div>
  )
}

/** 总强度滑块：不受分组开关影响，始终可调 */
function renderAlwaysSlider(
  def: SliderDef,
  params: ShakeParams,
  setParam: <K extends keyof ShakeParams>(key: K, value: ShakeParams[K]) => void
): React.JSX.Element {
  const value = params[def.key] as number
  const dec = decimalsOf(def.step)
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-muted-foreground w-16 shrink-0">{def.label}</span>
      <input
        type="range"
        min={def.min}
        max={def.max}
        step={def.step}
        value={value}
        onChange={(e) => setParam(def.key, Number(e.target.value))}
        className="flex-1 h-1 accent-primary cursor-pointer"
      />
      <span className="text-[11px] font-mono text-foreground w-14 shrink-0 text-right tabular-nums">
        {value.toFixed(dec)}
      </span>
    </div>
  )
}
