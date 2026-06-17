# 画布自动排版算法：黄金角螺旋落点

## 背景

当用户从探索/分类视图拖入图片到画布，或通过右键菜单批量加入时，需要自动决定落点。目标：**永远找到离画布内容视觉中心最近的可用位置**，不重叠，不偏向任何方向。

## 行业参照

| 工具 | 策略 |
|---|---|
| PureRef | 落在视口中心，允许重叠 |
| Figma / Miro | 落在视口中心，重叠时 +10/+10px 阶梯偏移 |
| Eagle | 手动拖拽，无自动排版 |
| Milanote | 对齐固定网格 |

结论："最近可用位置"比行业标准更高，值得专门实现。

## 算法：黄金角螺旋 + AABB 碰撞测试

### 核心公式

```
黄金角 φ = 137.508°（≈ 2π / φ²，φ 为黄金比例）

候选点 i（i = 0, 1, 2, ...）：
  r = baseStep × √i
  θ = i × 137.508° × (π/180)
  x = centerX + r × cos(θ)
  y = centerY + r × sin(θ)
```

- `i=0` 时 r=0，即先测试正中心
- 之后向外"向日葵种子"状均匀扩散，无方向偏好
- `baseStep` 建议取新图较短边的 0.6 倍

### 碰撞测试

对每个候选点，测试新图 AABB 是否与任意现有图 AABB 相交（含 gap 间距）：

```
新图 AABB = [cx - w/2 - gap, cy - h/2 - gap, cx + w/2 + gap, cy + h/2 + gap]
现有图 AABB = [item.x - item.w/2, item.y - item.h/2, item.x + item.w/2, item.y + item.h/2]
相交条件：两矩形在 x 和 y 轴均有重叠
```

第一个不相交的候选点即为结果。

### 视觉中心计算

取所有现有图的整体 AABB 的中心：

```
minX = min(item.x - item.w/2)
maxX = max(item.x + item.w/2)
centerX = (minX + maxX) / 2
centerY = (minY + maxY) / 2
```

画布无图时直接返回 `(0, 0)`。

### 性能估算

- 50 张图的画布：通常 5–15 次迭代找到落点
- 每次迭代：O(n) AABB 检测
- 总体极轻，无需 Web Worker

### gap 参数

建议默认 `gap = 16`（px，世界坐标），批量加入时可适当缩小到 8。

## 实现位置

```ts
// src/renderer/src/lib/canvasMath.ts
export function findPlacementPosition(
  items: CanvasItem[],
  newW: number,
  newH: number,
  gap = 16
): { x: number; y: number }
```

## 实现时机

等画布基础交互完成后再实现：
- [ ] 元素选中
- [ ] 元素移动（拖拽）
- [ ] 元素删除
- [ ] 批量加入画布

以上完成后，排版算法才有实际使用场景可以验证。
