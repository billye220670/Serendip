/**
 * 画布裁剪几何库
 *
 * 裁剪交互：用户在世界坐标系下画一个轴对齐矩形，对元素当前可见多边形求交。
 * 旋转过的元素被轴对齐矩形裁剪会产生多边形（如 45° 正方形 → 八边形）。
 *
 * 关键设计：操纵框与图像内容解耦
 * - 裁后元素的「外层框」= 可见多边形的世界 AABB，rotation=0 → 操纵框轴对齐
 * - 「内层图像」(content) 保存图像在框内的旋转矩形位置 → 内容保持原朝向，
 *   否则把 rotation 归零会让 180° 倒置图变正立、45° 图内容被转正（bug）
 *
 * 坐标系约定：
 * - clip 归一化坐标：[0,1]²，原点为外层框左上角（CSS clip-path 用）
 * - content：图像中心相对框中心的世界单位偏移 cx/cy、世界尺寸 w/h、相对框的旋转 rot
 */

export type Point = { x: number; y: number }

export interface WorldRect {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** 图像在外层框内的放置（旋转矩形）。cx/cy/w/h 为世界单位，rot 相对外层框 */
export interface ContentXform {
  cx: number
  cy: number
  w: number
  h: number
  rot: number
}

/** clip_polygon 列存储的结构（JSON） */
export interface ClipData {
  clip: Point[]
  content: ContentXform
}

/** 单条半平面裁剪（Sutherland–Hodgman 的一步） */
function clipHalfPlane(
  poly: Point[],
  inside: (p: Point) => boolean,
  intersect: (a: Point, b: Point) => Point
): Point[] {
  if (poly.length === 0) return []
  const out: Point[] = []
  const n = poly.length
  for (let i = 0; i < n; i++) {
    const cur = poly[i]
    const prev = poly[(i + n - 1) % n]
    const curIn = inside(cur)
    const prevIn = inside(prev)
    if (curIn) {
      if (!prevIn) out.push(intersect(prev, cur))
      out.push(cur)
    } else if (prevIn) {
      out.push(intersect(prev, cur))
    }
  }
  return out
}

/**
 * 线段 a→b 与一条无限直线（由 (ex1,ey1)→(ex2,ey2) 定义）的交点。
 * 裁剪矩形四条边均为轴对齐，不会与多边形边真正平行重合，denom≈0 时退回 a。
 */
function segLineIntersect(
  a: Point,
  b: Point,
  ex1: number,
  ey1: number,
  ex2: number,
  ey2: number
): Point {
  const dx1 = b.x - a.x
  const dy1 = b.y - a.y
  const dx2 = ex2 - ex1
  const dy2 = ey2 - ey1
  const denom = dx1 * dy2 - dy1 * dx2
  if (Math.abs(denom) < 1e-12) return a
  const t = ((ex1 - a.x) * dy2 - (ey1 - a.y) * dx2) / denom
  return { x: a.x + t * dx1, y: a.y + t * dy1 }
}

/** 用轴对齐矩形裁剪任意多边形（Sutherland–Hodgman）。结果 < 3 点表示无交集。 */
export function clipPolygonByRect(subject: Point[], rect: WorldRect): Point[] {
  const { minX, minY, maxX, maxY } = rect
  let poly = subject

  // 左边：x >= minX
  poly = clipHalfPlane(
    poly,
    (p) => p.x >= minX,
    (a, b) => segLineIntersect(a, b, minX, minY, minX, maxY)
  )
  // 右边：x <= maxX
  poly = clipHalfPlane(
    poly,
    (p) => p.x <= maxX,
    (a, b) => segLineIntersect(a, b, maxX, minY, maxX, maxY)
  )
  // 上边：y >= minY
  poly = clipHalfPlane(
    poly,
    (p) => p.y >= minY,
    (a, b) => segLineIntersect(a, b, minX, minY, maxX, minY)
  )
  // 下边：y <= maxY
  poly = clipHalfPlane(
    poly,
    (p) => p.y <= maxY,
    (a, b) => segLineIntersect(a, b, minX, maxY, maxX, maxY)
  )

  return poly
}

function rotate(x: number, y: number, cos: number, sin: number): Point {
  return { x: x * cos - y * sin, y: x * sin + y * cos }
}

/** 解析 clip_polygon JSON 为 ClipData；非法返回 null（视为未裁剪） */
export function parseClipData(s: string | null): ClipData | null {
  if (!s) return null
  try {
    const obj = JSON.parse(s) as unknown
    // 仅接受新结构 {clip, content}
    if (
      obj &&
      typeof obj === 'object' &&
      Array.isArray((obj as ClipData).clip) &&
      (obj as ClipData).clip.length >= 3 &&
      (obj as ClipData).content &&
      typeof (obj as ClipData).content.cx === 'number'
    ) {
      return obj as ClipData
    }
    return null
  } catch {
    return null
  }
}

export interface CropResult {
  x: number
  y: number
  w: number
  h: number
  rotation: number
  clipPolygon: string
}

/**
 * 对元素应用一个世界坐标系裁剪矩形，返回裁后封装到 AABB 的新几何。
 *
 * - 已有 ClipData 时以其 clip 作为 subject（重复裁剪正确累积）；无则用单位矩形
 * - 输出多边形的世界 AABB 成为新的 x/y/w/h，rotation 归零（操纵框轴对齐）
 * - content 记录图像在新框内的旋转矩形放置，保证内容朝向/像素不变
 *
 * 返回 null 表示与裁剪矩形无交集（或退化），调用方应跳过该元素。
 */
export function cropItem(
  item: {
    x: number
    y: number
    w: number
    h: number
    rotation: number
    clipPolygon: string | null
  },
  worldRect: WorldRect
): CropResult | null {
  const cos = Math.cos(item.rotation)
  const sin = Math.sin(item.rotation)

  const prev = parseClipData(item.clipPolygon)
  // 当前可见多边形（外层框归一化坐标）
  const clipNorm: Point[] = prev?.clip ?? [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 }
  ]
  // 当前图像放置；未裁剪时图像恰好填满框（cx/cy=0，尺寸=框尺寸，rot=0）
  const content: ContentXform = prev?.content ?? {
    cx: 0,
    cy: 0,
    w: item.w,
    h: item.h,
    rot: 0
  }

  // 1. 可见多边形：外层框归一化 → 框局部（世界单位）→ 世界
  const worldPoly = clipNorm.map((p) => {
    const lx = (p.x - 0.5) * item.w
    const ly = (p.y - 0.5) * item.h
    const w = rotate(lx, ly, cos, sin)
    return { x: w.x + item.x, y: w.y + item.y }
  })

  // 2. 世界空间求交
  const clipped = clipPolygonByRect(worldPoly, worldRect)
  if (clipped.length < 3) return null

  // 3. 输出多边形的世界 AABB → 新外层框
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of clipped) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  const newW = maxX - minX
  const newH = maxY - minY
  if (newW < 2 || newH < 2) return null
  const newCx = (minX + maxX) / 2
  const newCy = (minY + maxY) / 2

  // 4. 图像的世界放置（由旧 content + 旧框推得）
  const imgOff = rotate(content.cx, content.cy, cos, sin)
  const imgWorldCx = item.x + imgOff.x
  const imgWorldCy = item.y + imgOff.y
  const imgWorldRot = item.rotation + content.rot

  // 5. 新 content：图像放置相对新框（新框 rotation=0，故直接平移）
  const newContent: ContentXform = {
    cx: imgWorldCx - newCx,
    cy: imgWorldCy - newCy,
    w: content.w,
    h: content.h,
    rot: imgWorldRot
  }

  // 6. 新 clip：裁后多边形在新框归一化坐标
  const newClip = clipped.map((p) => ({
    x: (p.x - newCx) / newW + 0.5,
    y: (p.y - newCy) / newH + 0.5
  }))

  const data: ClipData = { clip: newClip, content: newContent }
  return {
    x: newCx,
    y: newCy,
    w: newW,
    h: newH,
    rotation: 0,
    clipPolygon: JSON.stringify(data)
  }
}

/**
 * ClipData → CSS clip-path 值。null/非法返回 undefined（调用方省略该属性）。
 */
export function clipPolygonToCSS(clipPolygon: string | null): string | undefined {
  const data = parseClipData(clipPolygon)
  if (!data) return undefined
  const coords = data.clip
    .map((p) => `${(p.x * 100).toFixed(3)}% ${(p.y * 100).toFixed(3)}%`)
    .join(', ')
  return `polygon(${coords})`
}

/**
 * 均匀缩放裁剪元素的内容放置（外层框缩放 k 倍时调用）。
 * clip 多边形是框归一化坐标、缩放下不变；只有 content（世界单位）需 ×k。
 * 无裁剪数据则原样返回。
 */
export function scaleClipContent(clipPolygon: string | null, k: number): string | null {
  const data = parseClipData(clipPolygon)
  if (!data) return clipPolygon
  const c = data.content
  const scaled: ClipData = {
    clip: data.clip,
    content: { cx: c.cx * k, cy: c.cy * k, w: c.w * k, h: c.h * k, rot: c.rot }
  }
  return JSON.stringify(scaled)
}
