import { useState, useRef, useCallback, useEffect, cloneElement } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'

interface TooltipProps {
  text: string | undefined | null
  children: React.ReactElement
  side?: 'top' | 'right' | 'bottom' | 'left'
  /** 延迟显示 ms，默认 600 */
  delay?: number
}

interface PopupProps {
  text: string
  pos: { x: number; y: number }
  side: 'top' | 'right' | 'bottom' | 'left'
}

function TooltipPopup({ text, pos, side }: PopupProps): React.JSX.Element {
  const isHorizontal = side === 'left' || side === 'right'
  return (
    <div
      className={clsx(
        'fixed z-[300] pointer-events-none',
        'bg-sidebar border border-border text-foreground text-xs px-2.5 py-1.5 rounded-lg shadow-lg whitespace-nowrap'
      )}
      style={
        isHorizontal
          ? {
              top: pos.y,
              transform: 'translateY(-50%)',
              ...(side === 'left' ? { right: window.innerWidth - pos.x } : { left: pos.x })
            }
          : {
              left: pos.x,
              transform: 'translateX(-50%)',
              ...(side === 'top' ? { bottom: window.innerHeight - pos.y } : { top: pos.y })
            }
      }
    >
      {text}
    </div>
  )
}

/**
 * 自定义 tooltip，样式与侧栏折叠态 tooltip 一致。
 * 通过 cloneElement 注入 hover 事件，不要求子元素做任何修改。
 */
export function Tooltip({ text, children, side = 'top', delay = 600 }: TooltipProps): React.JSX.Element {
  const [visible, setVisible] = useState(false)
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const timerRef = useRef<number | null>(null)

  const show = useCallback((el: HTMLElement) => {
    if (!text) return
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      const r = el.getBoundingClientRect()
      const GAP = 6
      let x = 0, y = 0
      if (side === 'top')    { x = r.left + r.width / 2; y = r.top - GAP }
      if (side === 'bottom') { x = r.left + r.width / 2; y = r.bottom + GAP }
      if (side === 'left')   { x = r.left - GAP; y = r.top + r.height / 2 }
      if (side === 'right')  { x = r.right + GAP; y = r.top + r.height / 2 }
      setPos({ x, y })
      setVisible(true)
    }, delay)
  }, [text, side, delay])

  const hide = useCallback(() => {
    if (timerRef.current !== null) { window.clearTimeout(timerRef.current); timerRef.current = null }
    setVisible(false)
  }, [])

  useEffect(() => () => { if (timerRef.current !== null) window.clearTimeout(timerRef.current) }, [])

  if (!text) return children

  const origProps = children.props as React.HTMLAttributes<HTMLElement>
  const cloned = cloneElement(children, {
    title: undefined,
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => { origProps.onMouseEnter?.(e); show(e.currentTarget) },
    onMouseLeave: (e: React.MouseEvent<HTMLElement>) => { origProps.onMouseLeave?.(e); hide() },
    onPointerLeave: (e: React.PointerEvent<HTMLElement>) => { origProps.onPointerLeave?.(e); hide() },
    onFocus: (e: React.FocusEvent<HTMLElement>) => { origProps.onFocus?.(e); show(e.currentTarget) },
    onBlur: (e: React.FocusEvent<HTMLElement>) => { origProps.onBlur?.(e); hide() },
  } as React.HTMLAttributes<HTMLElement>)

  return (
    <>
      {cloned}
      {visible && createPortal(<TooltipPopup text={text} pos={pos} side={side} />, document.body)}
    </>
  )
}
