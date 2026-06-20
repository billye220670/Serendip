/**
 * 1D 值噪声（value noise）—— 平滑、可种子化、零依赖。
 *
 * 用于摄影机手摇的连续游移：在整数格点上生成伪随机值 [-1,1]，
 * 用 smoothstep 在格点间插值，得到 C1 连续的平滑曲线。
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

/** 5 次 smoothstep（更平滑，二阶导也连续，避免格点处可见折角） */
function smooth(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10)
}

export interface NoiseFn {
  /** 取 stream 路噪声在位置 x 处的值，结果 ∈ [-1,1] */
  (stream: number, x: number): number
}

/**
 * 用给定种子构造一个 1D 值噪声函数。
 * 同一 seed + 同一 stream + 同一 x → 恒定结果（确定性，便于复现/调试）。
 */
export function makeNoise(seed: number): NoiseFn {
  const s = seed | 0
  return (stream: number, x: number): number => {
    const i = Math.floor(x)
    const f = x - i
    // 格点伪随机值（[0,1) → [-1,1]）。stream 与 seed 折进哈希分隔各路。
    const base = Math.imul(stream + 1, 0x9e3779b1) ^ Math.imul(s, 0x85ebca6b)
    const a = hash(base ^ Math.imul(i, 0x27d4eb2f)) * 2 - 1
    const b = hash(base ^ Math.imul(i + 1, 0x27d4eb2f)) * 2 - 1
    return a + (b - a) * smooth(f)
  }
}
