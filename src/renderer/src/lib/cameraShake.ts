/**
 * 摄影机手摇 —— 纯运动引擎（零 React / 零 DOM，可单测）。
 *
 * 运动 = 两部分 compose（叠加）：
 *  1. 噪声游移（noise）：机位持续的平滑游移，永不停歇。
 *  2. 脉冲抖动（pulse）：每隔一段时间「咯噔」抖一下，衰减振荡回弹。
 * 最终偏移 = (噪声 + 脉冲) × 总强度 × 启用淡入。
 *
 * 详见 docs/CanvasPlan/stage6.md。
 */
import { makeNoise, type NoiseFn } from './valueNoise'

export interface ShakeParams {
  /** 总强度乘子，0=静止，2=翻倍 */
  masterIntensity: number
  // ── 噪声游移（摇摆）──
  /** 摇摆分组开关 */
  noiseEnabled: boolean
  /** 位移振幅（屏幕像素） */
  noisePosAmp: number
  /** 位移噪声频率（Hz） */
  noisePosFreq: number
  /** 旋转振幅（度） */
  noiseRotAmp: number
  /** 旋转噪声频率（Hz） */
  noiseRotFreq: number
  /** 缩放振幅（相对 1.0 的 ± 比例） */
  noiseZoomAmp: number
  /** 缩放噪声频率（Hz） */
  noiseZoomFreq: number
  /** 噪声种子（决定相位） */
  noiseSeed: number
  // ── 脉冲抖动 ──
  /** 脉冲分组开关 */
  pulseEnabled: boolean
  /** 脉冲位移峰值（屏幕像素） */
  pulsePosAmp: number
  /** 脉冲旋转峰值（度） */
  pulseRotAmp: number
  /** 脉冲缩放峰值（相对 1.0 的 ± 比例） */
  pulseZoomAmp: number
  /** 脉冲基础间隔（秒） */
  pulseInterval: number
  /** 间隔随机 ± 增益（秒） */
  pulseIntervalJitter: number
  /** 单次脉冲衰减时间常数（秒） */
  pulseDecay: number
  /** 脉冲内回弹频率（Hz），0=纯衰减不回弹 */
  pulseWobble: number
}

export interface ShakeOffset {
  /** 屏幕像素 */
  dx: number
  /** 屏幕像素 */
  dy: number
  /** 弧度 */
  dRot: number
  /** 乘子，1=不缩放 */
  dScale: number
}

export const ZERO_OFFSET: ShakeOffset = Object.freeze({ dx: 0, dy: 0, dRot: 0, dScale: 1 })

/** 温和的手持默认值；enabled 由 store 单独管理（默认关） */
export const DEFAULT_SHAKE_PARAMS: ShakeParams = {
  masterIntensity: 1,
  noiseEnabled: true,
  noisePosAmp: 12,
  noisePosFreq: 0.5,
  noiseRotAmp: 0.6,
  noiseRotFreq: 0.4,
  noiseZoomAmp: 0.01,
  noiseZoomFreq: 0.3,
  noiseSeed: 1,
  pulseEnabled: true,
  pulsePosAmp: 40,
  pulseRotAmp: 1.5,
  pulseZoomAmp: 0.02,
  pulseInterval: 4,
  pulseIntervalJitter: 2,
  pulseDecay: 0.4,
  pulseWobble: 6
}

const DEG2RAD = Math.PI / 180
/** 启用淡入时长（秒） */
const RAMP_DURATION = 0.4
/** 包络衰减到此以下即剔除脉冲 */
const PULSE_CUTOFF = 0.001

// 噪声 stream 分配
const STREAM_X = 0
const STREAM_Y = 1
const STREAM_ROT = 2
const STREAM_ZOOM = 3

interface ActivePulse {
  startT: number
  /** 位移方向角 */
  angle: number
  /** 旋转符号 ±1 */
  rotSign: number
  /** 缩放符号 ±1 */
  zoomSign: number
}

export interface ShakeRunner {
  /** 推进调度并产出当前帧偏移 */
  sample(params: ShakeParams, tSeconds: number): ShakeOffset
  /** 立刻塞入一个脉冲（面板「测试脉冲」用） */
  pulseNow(): void
  /** 复位调度 / 淡入（停用时调用，下次启用重新淡入） */
  reset(): void
}

/**
 * 构造一个独立的手摇运行器。每个 consumer 各持一个 → 脉冲时序互不同步
 * （各自独立呼吸），但算法与参数完全同源。
 */
export function createShakeRunner(): ShakeRunner {
  let noiseFn: NoiseFn | null = null
  let noiseSeedCache = NaN
  let rampStart: number | null = null
  let nextPulseAt: number | null = null
  let lastT = 0
  const pulses: ActivePulse[] = []

  function spawnPulse(startT: number): void {
    pulses.push({
      startT,
      angle: Math.random() * Math.PI * 2,
      rotSign: Math.random() < 0.5 ? -1 : 1,
      zoomSign: Math.random() < 0.5 ? -1 : 1
    })
  }

  function reset(): void {
    rampStart = null
    nextPulseAt = null
    pulses.length = 0
  }

  function pulseNow(): void {
    spawnPulse(lastT)
  }

  function sample(params: ShakeParams, t: number): ShakeOffset {
    lastT = t

    // 噪声函数按 seed 缓存（随机种子按钮改 seed 时重建）
    if (params.noiseSeed !== noiseSeedCache) {
      noiseSeedCache = params.noiseSeed
      noiseFn = makeNoise(params.noiseSeed)
    }
    const noise = noiseFn as NoiseFn

    // 启用淡入
    if (rampStart === null) rampStart = t
    const ramp = Math.min(1, Math.max(0, (t - rampStart) / RAMP_DURATION))

    // ── 噪声游移（摇摆）── 分组关闭时输出 0
    let nDx = 0
    let nDy = 0
    let nRot = 0
    let nZoom = 0
    if (params.noiseEnabled) {
      nDx = noise(STREAM_X, t * params.noisePosFreq) * params.noisePosAmp
      nDy = noise(STREAM_Y, t * params.noisePosFreq) * params.noisePosAmp
      nRot = noise(STREAM_ROT, t * params.noiseRotFreq) * params.noiseRotAmp * DEG2RAD
      nZoom = noise(STREAM_ZOOM, t * params.noiseZoomFreq) * params.noiseZoomAmp
    }

    // ── 脉冲叠加（衰减振荡包络）── 分组关闭时不调度、不叠加
    let pDx = 0
    let pDy = 0
    let pRot = 0
    let pZoom = 0
    if (params.pulseEnabled) {
      // ── 脉冲调度 ──
      if (nextPulseAt === null) {
        nextPulseAt = t + nextInterval(params)
      }
      // 追上当前时间（防 tab 切换后 t 跳变导致积压，限次数）
      let guard = 0
      while (t >= nextPulseAt && guard < 16) {
        spawnPulse(nextPulseAt)
        nextPulseAt += nextInterval(params)
        guard++
      }
      if (guard >= 16) nextPulseAt = t + nextInterval(params)

      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = pulses[i]
        const tau = t - p.startT
        const decayAmp = Math.exp(-tau / params.pulseDecay)
        if (decayAmp < PULSE_CUTOFF) {
          pulses.splice(i, 1)
          continue
        }
        const env = decayAmp * Math.cos(2 * Math.PI * params.pulseWobble * tau)
        pDx += Math.cos(p.angle) * params.pulsePosAmp * env
        pDy += Math.sin(p.angle) * params.pulsePosAmp * env
        pRot += p.rotSign * params.pulseRotAmp * DEG2RAD * env
        pZoom += p.zoomSign * params.pulseZoomAmp * env
      }
    } else {
      // 关闭脉冲：清空调度与活跃脉冲，重开时从头排
      nextPulseAt = null
      pulses.length = 0
    }

    // ── compose + 总强度 + 淡入 ──
    const k = params.masterIntensity * ramp
    return {
      dx: (nDx + pDx) * k,
      dy: (nDy + pDy) * k,
      dRot: (nRot + pRot) * k,
      dScale: 1 + (nZoom + pZoom) * k
    }
  }

  return { sample, pulseNow, reset }
}

/** 下一次脉冲间隔 = base ± 随机增益（下限 0.05s） */
function nextInterval(params: ShakeParams): number {
  const jitter = (Math.random() * 2 - 1) * params.pulseIntervalJitter
  return Math.max(0.05, params.pulseInterval + jitter)
}

/** 偏移 → CSS transform 字符串（transform-origin 须为 center） */
export function shakeTransform(o: ShakeOffset): string {
  return `translate(${o.dx}px, ${o.dy}px) rotate(${o.dRot}rad) scale(${o.dScale})`
}
