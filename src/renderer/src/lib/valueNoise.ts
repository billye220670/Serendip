/**
 * 1D 值噪声（value noise）—— 平滑、可种子化、零依赖。
 *
 * 用于摄影机手摇的连续游移：在整数格点上生成伪随机值 [-1,1]，再插值成曲线。
 *
 * 两个让运动「有机/连续」而非「机械」的关键设计：
 *  1. Catmull-Rom 插值（而非 smoothstep）。smoothstep 在每个格点处导数为 0，
 *     即曲线在每个随机锚点都会「减速到停、再出发」——这正是「从一个随机点
 *     插值到另一个随机点」的机械感来源。Catmull-Rom 以相邻点的斜率为切线，
 *     带着「动量」流过格点，速度连续、不停顿。
 *  2. fBm（分形布朗运动 / 多倍频程叠加）。单一频率只有一个可见周期，节奏死板；
 *     叠加「慢漂移 + 中颤 + 细微抖」多层尺度后，没有单一主周期，像真实手持。
 *
 * `stream` 参数让同一时间轴上可取多路互不相关的噪声（位移 x/y、旋转、缩放各一路）。
 */

/** 32-bit 整数混合哈希 → [0,1) */
function hash(x: number): number {
  let h = x | 0
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
  h = (h ^ (h >>> 16)) >>> 0
  return h / 4294967296
}

/**
 * 单倍频程：4 点 Catmull-Rom 插值的值噪声。
 * 经过 p1（f=0）与 p2（f=1），切线取相邻点斜率 → 流过格点不停顿。
 * 注意会有轻微 overshoot（>|1|），这恰好带来自然的「惯性回甩」，可接受。
 */
function octave(rand: (i: number) => number, x: number): number {
  const i = Math.floor(x)
  const f = x - i
  const p0 = rand(i - 1)
  const p1 = rand(i)
  const p2 = rand(i + 1)
  const p3 = rand(i + 2)
  // Catmull-Rom（Hermite，切线 = (相邻点之差)/2）的 Horner 展开
  return (
    p1 +
    0.5 * f * (p2 - p0 + f * (2 * p0 - 5 * p1 + 4 * p2 - p3 + f * (3 * (p1 - p2) + p3 - p0)))
  )
}

export interface NoiseFn {
  /** 取 stream 路噪声在位置 x 处的值，结果 ≈[-1,1]（含轻微 overshoot） */
  (stream: number, x: number): number
}

/** fBm 倍频程数 */
const OCTAVES = 4
/** 每程频率倍率 */
const LACUNARITY = 2
/** 每程振幅衰减 */
const GAIN = 0.5

/**
 * 用给定种子构造一个 1D 值噪声函数（fBm + Catmull-Rom）。
 * 同一 seed + 同一 stream + 同一 x → 恒定结果（确定性，便于复现/调试）。
 */
export function makeNoise(seed: number): NoiseFn {
  const s = seed | 0
  return (stream: number, x: number): number => {
    // 格点伪随机值（[0,1) → [-1,1]）。stream 与 seed 折进哈希分隔各路。
    const base = Math.imul(stream + 1, 0x9e3779b1) ^ Math.imul(s, 0x85ebca6b)
    const rand = (i: number): number => hash(base ^ Math.imul(i, 0x27d4eb2f)) * 2 - 1

    let amp = 1
    let freq = 1
    let sum = 0
    let norm = 0
    for (let o = 0; o < OCTAVES; o++) {
      // 每程加不同相位偏移，错开各程格点，避免拐点对齐
      sum += octave(rand, x * freq + o * 31.7) * amp
      norm += amp
      amp *= GAIN
      freq *= LACUNARITY
    }
    return sum / norm
  }
}
