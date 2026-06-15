import { useEffect, useRef } from 'react'
import { useUIStore } from '../stores/ui'

// 与 App.tsx 侧栏 transition-[width] duration-[250ms] 保持一致
const SIDEBAR_ANIM_MS = 250

/**
 * 侧栏折叠/展开时，main 宽度会做 250ms 的过渡动画。
 * react-photo-album 用 ResizeObserver 监听容器宽度，宽度每帧变化就会重算
 * 整张瀑布流布局——深滚后已加载卡片很多，每帧重排会明显卡顿。
 *
 * 这个 hook 在动画期间把容器冻结在当前像素宽度，动画结束后再释放，
 * 使整段动画里瀑布流只在结束时重排「一次」。
 *
 * 注意：冻结期间容器宽度与 main 实际宽度会短暂不一致——
 * - 折叠（main 变宽）：容器偏窄，右侧留白，无副作用；
 * - 展开（main 变窄）：容器偏宽会溢出，由 main 的 `overflow-x-clip` 裁掉。
 *
 * 返回的 ref 挂到 Masonry 的容器（各视图的 p-4 根节点）上。
 */
export function useSidebarFreeze(): React.RefObject<HTMLDivElement> {
  const ref = useRef<HTMLDivElement>(null)
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed)
  const first = useRef(true)

  useEffect(() => {
    // 首次挂载不是真正的折叠切换，跳过
    if (first.current) {
      first.current = false
      return
    }
    const el = ref.current
    if (!el) return
    // 冻结到当前像素宽度
    el.style.width = `${el.clientWidth}px`
    const release = (): void => {
      el.style.width = ''
    }
    const timer = window.setTimeout(release, SIDEBAR_ANIM_MS + 50)
    return () => {
      window.clearTimeout(timer)
      release()
    }
  }, [sidebarCollapsed])

  return ref
}
