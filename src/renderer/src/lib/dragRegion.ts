/**
 * 判断事件目标是否落在标题栏拖拽区域（-webkit-app-region:drag），
 * 遇到 no-drag 子元素立即返回 false，遇到 drag 样式或 data-drag-region 属性返回 true。
 */
export function isOnDragRegion(target: EventTarget | null): boolean {
  let el = target as HTMLElement | null
  while (el && el !== document.body) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = el.style.getPropertyValue('-webkit-app-region') || (el.style as any).WebkitAppRegion || ''
    if (r === 'no-drag') return false
    if (r === 'drag') return true
    if (el.dataset.dragRegion === 'true') return true
    el = el.parentElement
  }
  return false
}
