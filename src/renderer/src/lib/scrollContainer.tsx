import { createContext, useContext, useEffect, useRef, useState } from 'react'

/**
 * 主滚动容器上下文 —— App 把 <main> element 通过此 context 传下去，
 * MasonryGrid 用它换出 masonic 默认的 window 滚动模型。
 *
 * 历史背景：
 * 早期整个页面跟随 window 滚动，masonic 自带的 useScroller 直接监听 window scroll。
 * 重构成"顶栏不滚 + 主区独立滚动"后，scrollbar 自然从顶栏下沿开始（视觉一致），
 * 但 masonic 的窗口滚动模型不再适用 —— 必须改读 main 容器的 scrollTop / clientHeight。
 *
 * 关键点：context 里放的是 element 状态而非 ref。React ref.current 变化不触发子组件 re-render，
 * MasonryGrid 用 useContainerScroller 时需要在元素 ready 后立刻拿到、并随后续变化重新订阅。
 *
 * 用法：App 里 `<ScrollContainerContext.Provider value={mainEl}>`，子组件 useScrollContainer。
 */
export const ScrollContainerContext = createContext<HTMLElement | null>(null)

export function useScrollContainer(): HTMLElement | null {
  return useContext(ScrollContainerContext)
}

/**
 * 容器滚动 hook（替代 masonic 的 useScroller）。
 *
 * 行为对照 useScroller：
 * - scrollTop: 容器的 scrollTop 减去 masonry 容器在容器内的偏移（masonry 上方的 padding / 兄弟元素）
 * - isScrolling: 滚动期间真值，停滚 ~140ms 后转 false（让 masonic 关闭 pointer-events 优化）
 * - viewportHeight: 容器自身 clientHeight，不再是 window.innerHeight
 *
 * @param scrollEl 滚动容器 DOM。null 时返回零值兜底（element 还没挂上 ref 的瞬间）
 * @param offsetTop masonry 容器在 scrollEl 内的 offsetTop（视图加 padding 时非 0）
 */
export function useContainerScroller(
  scrollEl: HTMLElement | null,
  offsetTop: number
): { scrollTop: number; isScrolling: boolean; viewportHeight: number } {
  const [scrollTop, setScrollTop] = useState(0)
  const [isScrolling, setIsScrolling] = useState(false)
  const [viewportHeight, setViewportHeight] = useState(() =>
    scrollEl ? scrollEl.clientHeight : window.innerHeight
  )
  const idleTimer = useRef<number | null>(null)

  useEffect(() => {
    if (!scrollEl) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setViewportHeight(scrollEl.clientHeight)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setScrollTop(scrollEl.scrollTop)

    const onScroll = (): void => {
      setScrollTop(scrollEl.scrollTop)
      setIsScrolling(true)
      if (idleTimer.current !== null) window.clearTimeout(idleTimer.current)
      idleTimer.current = window.setTimeout(() => setIsScrolling(false), 140)
    }
    scrollEl.addEventListener('scroll', onScroll, { passive: true })

    // 监听容器尺寸变化（窗口缩放、侧栏折叠改变 main 宽高）
    const ro = new ResizeObserver(() => setViewportHeight(scrollEl.clientHeight))
    ro.observe(scrollEl)

    return () => {
      scrollEl.removeEventListener('scroll', onScroll)
      ro.disconnect()
      if (idleTimer.current !== null) window.clearTimeout(idleTimer.current)
    }
  }, [scrollEl])

  return {
    scrollTop: Math.max(0, scrollTop - offsetTop),
    isScrolling,
    viewportHeight
  }
}
