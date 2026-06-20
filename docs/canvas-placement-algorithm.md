# 画布自动排版算法：等高行网格（justified rows）

## 背景

当用户从探索/分类视图拖入图片到画布，或通过右键菜单批量加入时，需要自动决定落点。目标：**新增 N 张图片后，元素按各自比例自动排成尽可能整齐的网格**（对齐 PureRef 的紧凑观感），而不是早期的"斜向阶梯叠加"。

两个明确诉求：
1. 加入 N 张图后形成整齐网格 —— 主场景（空画布批量加入）。
2. 已有元素时，新图落在**离现有内容最近的空白处**，且**不打乱已有元素**。

## 行业参照

| 工具 | 策略 |
|---|---|
| PureRef | 紧凑排版，图片保留各自比例、彼此紧贴 |
| Figma / Miro | 落在视口中心，重叠时 +10/+10px 阶梯偏移 |
| Eagle | 手动拖拽，无自动排版 |
| Milanote | 对齐固定网格 |

结论：采用**等高行（justified rows）**——所有图等高、宽随比例、贪心换行使整块趋近正方形，行右缘大致对齐。这是混合比例图片最"整齐"且不浪费空间的网格形态。

## 算法

### 1. 等高行布局 `layoutJustifiedRows(aspects, {rowHeight, gap})`

- 每项缩放到统一行高 `H`（默认 `GRID_ROW_HEIGHT = 240` 世界px），宽 = `H × 宽高比`（比例非法回退 4:3）。
- 目标行数 `R = round(√(ΣW / H))`（此时整块接近正方形），目标行宽 `targetRowW = ΣW / R`。
- 贪心填充：逐项加入当前行，加入后超过 `targetRowW` 则换行。行间、项间留 `gap`（默认 `GRID_GAP = 16`）。
- 返回每项相对「块左上角原点」的中心坐标 `{x,y,w,h}` + 整块尺寸 `blockW/blockH`。调用方负责把块平移到锚点。

### 2. 整块空位放置 `findBlockPlacement(blockW, blockH, existing, gap)`

非空画布时，把新批次整块放到离现有内容视觉中心最近的空白处：

- 视觉中心 = 现有元素整体 AABB 的中心。
- **黄金角螺旋**候选：`r = baseStep·√i`，`θ = i·137.5°`，`baseStep = (max(blockW,blockH)+gap)·0.5`。向日葵种子式扩散，无方向偏好。
- 每个候选点测试「块 AABB（含 gap）」是否与任意现有元素 AABB 相交，首个不相交即返回。
- 空画布直接返回 `(0,0)`。

### 视觉中心 / AABB

旋转元素用 `aabbOfRotatedRect` 求轴对齐包围盒；矩形相交用中心距判据 `|Δx|·2 < w1+w2 && |Δy|·2 < h1+h2`。

## 使用点

- **加入画布** `stores/canvases.ts → addItems`：取 `getMediaDimensions(新fileIds)` 得真实比例 → `layoutJustifiedRows` 排块 → 空画布居中原点 / 非空 `findBlockPlacement` 定位 → 平移后用 **`addItemsToCanvasRaw`** 原样写入精确 `x/y/w/h/z`（不让主进程按固定宽重算）。新元素 z 全部高于现有。
- **一键重排全部** `views/canvas/CanvasView.tsx → handleRearrangeAll`（底部浮条 `LayoutGrid` 按钮）：对当前所有元素按现有顺序用同一 `layoutJustifiedRows`（比例取当前 `w/h`），居中于内容质心，`rotation` 归零，`updateItems` 批量改 `x/y/w/h/rotation`，**可撤销**（旧变换快照 push 到 `canvasUndoStore`），完成后 `handleFit` 适应视口。

## 实现位置

```ts
// src/renderer/src/lib/canvasMath.ts
export const GRID_ROW_HEIGHT = 240
export const GRID_GAP = 16
export function layoutJustifiedRows(aspects, opts?): { positions, blockW, blockH }
export function findBlockPlacement(blockW, blockH, existing, gap?): { x, y }

// src/main/canvases/index.ts
export function getMediaDimensions(fileIds): Array<{ id, width, height }>
```

## 性能

- 布局 O(n)；空位放置每候选 O(n)，常规几次迭代即命中。整体极轻，无需 Web Worker。
