// 自定义手型光标 —— 供画布模式与详情页锁定模式共用

const HAND_OPEN_PATHS = [
  'M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2',
  'M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2',
  'M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8',
  'M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15',
]
const HAND_GRAB_PATHS = [
  'M18 11.5V9a2 2 0 0 0-2-2a2 2 0 0 0-2 2v1.4',
  'M14 10V8a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2',
  'M10 9.9V9a2 2 0 0 0-2-2a2 2 0 0 0-2 2v5',
  'M6 14a2 2 0 0 0-2-2a2 2 0 0 0-2 2',
  'M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-4a8 8 0 0 1-8-8 2 2 0 1 1 4 0',
]

export function makeHandCursor(paths: string[], hotX: number, hotY: number): string {
  const attrs = 'fill="none" stroke-linecap="round" stroke-linejoin="round"'
  const dark  = paths.map(d => `<path d="${d}" ${attrs} stroke="rgba(0,0,0,0.65)" stroke-width="3.5"/>`).join('')
  const white = paths.map(d => `<path d="${d}" ${attrs} stroke="white" stroke-width="2"/>`).join('')
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24">` +
    dark + white +
    `</svg>`
  return `url("data:image/svg+xml;base64,${btoa(svg)}") ${hotX} ${hotY}, pointer`
}

// hotspot 单位是 cursor 图像像素（32px 空间），手掌中心约在 viewBox(11,10) → pixel(15,13)
export const CURSOR_HAND_OPEN = makeHandCursor(HAND_OPEN_PATHS, 15, 13)
export const CURSOR_HAND_GRAB = makeHandCursor(HAND_GRAB_PATHS, 15, 13)
