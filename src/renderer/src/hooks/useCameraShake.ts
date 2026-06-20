import { useEffect, useState } from 'react'
import { createShakeRunner, shakeTransform, type ShakeRunner } from '../lib/cameraShake'
import { useCameraShakeStore } from '../stores/cameraShake'

interface Options {
  /** 当前上下文是否处于「可被手摇」状态（如视图已挂载、媒体就绪） */
  active: boolean
}

/**
 * 通用摄影机手摇 hook —— 画布与详情锁定模式共用同一份实现。
 *
 * 给定一个**专属 transform 层**的 ref：当 `active && enabled` 时，
 * 起 RAF 每帧把手摇偏移直接写进 `targetRef.style.transform`（不走 React state，
 * 不触发重渲染）。停用 / 卸载时取消 RAF、清空 transform、复位调度。
 *
 * 该层的 `transform-origin` 须为 center，且其 transform 完全归本 hook 所有
 * （不要在该层叠加别的 transform）。
 */
export function useCameraShake(
  targetRef: React.RefObject<HTMLElement | null>,
  { active }: Options
): void {
  // 稳定的 runner 实例（每个 consumer 各持一个，时序独立、算法同源）
  const [runner] = useState<ShakeRunner>(() => createShakeRunner())

  // 仅订阅决定「是否运行」的开关；params 在 RAF 内用 getState 读，避免改参数重启 RAF
  const enabled = useCameraShakeStore((s) => s.enabled)
  const run = active && enabled

  useEffect(() => {
    const el = targetRef.current
    if (!el || !run) {
      if (el) el.style.transform = ''
      runner.reset()
      return
    }

    let rafId = 0
    const loop = (): void => {
      const params = useCameraShakeStore.getState().params
      const offset = runner.sample(params, performance.now() / 1000)
      el.style.transform = shakeTransform(offset)
      rafId = requestAnimationFrame(loop)
    }
    rafId = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(rafId)
      el.style.transform = ''
      runner.reset()
    }
  }, [run, runner, targetRef])
}
