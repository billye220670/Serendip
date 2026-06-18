# 阶段 2：画布主视图骨架 + 视口（pan/zoom/F 聚焦）+ 元素渲染 + 视口持久化

> 状态：✅ 已完成
> 所属计划：[main.md](main.md)

---

## 原始计划

**目标**：占位画布替换为真画布；图片元素渲染；pan/zoom 跟手且光标锚点；F 聚焦内容；切走再切回画面停在原位。**视频元素留到阶段 3**（先把图片这条主路径打通），**选择/变换留到阶段 3**。

**新建文件**：
- `src/renderer/src/stores/canvasItems.ts`：当前画布的 items + load/unload + addItems / updateItems（debounce flush）/ removeItems。
- `src/renderer/src/stores/canvasViewport.ts`：每画布视口 Map + debounce flush。
- `src/renderer/src/views/canvas/CanvasView.tsx`：替换阶段 1 占位。顶层 `<div ref containerRef>` 监听 wheel/pointer。
- `src/renderer/src/views/canvas/CanvasItemNode.tsx`：单元素渲染（图片版本）。`<div>` 套 `<img src="serendip://thumb/<id>">`（先用 thumb，原图等阶段 4 与裁剪一并处理；这里思路同 detail 视图先用低清图保持响应）。
- `src/renderer/src/views/canvas/CanvasToolbar.tsx`：底部工具栏骨架（玻璃质感，先放 F 聚焦、回中、缩放百分比、新建占位），具体按钮在后续阶段填。
- `src/renderer/src/lib/canvasMath.ts`：`screenToWorld` / `worldToScreen` / `aabbOfRotatedRect` / `fitViewport(items, viewW, viewH, padding)`。

**改动文件**：
- `src/renderer/src/App.tsx`：`view.kind==='canvas'` → 渲染 CanvasView。
- 删除阶段 1 占位 CanvasView。

**实现要点**：
- **wheel 事件**：监听 `containerRef`，区分 `e.ctrlKey || e.metaKey`（触摸板捏合 / Ctrl+滚轮）= zoom，否则 = pan（触摸板双指拖也走这）。**鼠标滚轮**默认是 zoom（设计 §3.1：滚轮 = zoom，不分情况），所以非触摸板就按 zoom 处理；区分方式是 `e.deltaMode === 0 && Math.abs(e.deltaY) < 50` 判触摸板倾向（实现细节阶段评估）。**先简化**：所有 wheel = zoom（光标锚点），双指 pan 走 trackpad 自带的双指拖（macOS 触摸板会触发 wheel + ctrlKey=true 表示捏合）。Mac 触摸板 pan 实际是 wheel + ctrlKey=false，所以**两键区分够用**：ctrlKey 区分 zoom/pan。
- **Pan 多入口**：
  - 中键（`pointerdown` + `e.button===1`）按下后 pointermove 改 viewport.xy
  - Space 按住 + 左键按下 + pointermove
  - 触摸板双指拖（wheel + ctrlKey=false）→ viewport.xy
- **Zoom 锚点**：见 §3.5 公式，clamp scale 到 [0.05, 32]。
- **元素渲染**：CanvasItemNode 顶层 `<div style={{ position:'absolute', left:0, top:0, transform: `translate(${screenX}px, ${screenY}px) rotate(${rot}rad) scale(${scale})` }}>`。坐标变换在 React 渲染时算（每帧），不依赖 transform-origin（直接把中心点位置算进 translate）。性能上元素数 <500 时直接每帧重算无虞；更多时考虑 RAF 批量。
- **视口持久化**：切走画布（unmount CanvasView）→ flush；切回 → load 时读 `canvases.viewport_*`。每次 viewport 变更 debounce 500ms 写库。
- **F 聚焦**：监听 keydown `f`（且不在 input 内）；`fitViewport(selected.length ? selected : items)`；空画布时弹提示"画布是空的"。
- **添加图片走入**：阶段 1 已经能 addItems；进画布看到这些 item 渲染出来；自动布局算法（在 useCanvasItemsStore.addItems 内）：从 viewport 中心开始，向下按列瀑布式排（240px 列宽、12px 间距），多张连续加时维护 next-slot 指针。
- **视口默认值**：新画布无 items 时 `viewport={x:0,y:0,scale:1}`；首次 addItems 后**自动居中第一张到画布中心**。
- 暂不渲染视频（CanvasItemNode 内 `if (item.type==='video') return null`），阶段 3 解决。

**测试清单**：
1. 进画布看到一张白底（暗色 dim 主题色）画布；空画布显示中央提示"把图片或视频拖进来开始"。
2. 从探索拖一张图到侧栏画布 pill → 不跳转；切到画布看到该图渲染在画布中心附近。
3. 滚轮上下 → zoom in/out；缩放锚点是光标位置（光标下的图保持在原位、其他位置随缩放移动）。
4. 中键拖动画布 → pan；松开停在原位。
5. 按住 Space + 左键拖 → 同样 pan；松开 Space 后左键变回正常。
6. 触摸板双指拖（macOS）→ pan 流畅。
7. 拖入多张图 → 自动按列瀑布排开，不重叠。
8. 按 F → fit 画布所有内容到视口（留 ~10% 边距）。
9. 选中状态下按 F → fit 选中（阶段 3 选中实装后再覆盖；阶段 2 因为没选区，F 全 fit 即可）。
10. 切走画布到探索，再切回 → 画面位置/缩放保留。退出 app 重启 → 仍保留（验证 DB 持久化）。
11. 缩放极限：极小（0.05）/极大（32）不爆炸；scale clamp 生效。
12. `npm run typecheck` 通过。

---

## 阶段 2 回顾（已完成，记录实际落地与原文档的出入）

### 设计变动

**1. 离散档位缩放取代百分比显示**

原文档：工具栏显示缩放原始百分比（如 `100%`）；滚轮区分 ctrlKey/pan。

**实际落地**：用户确认改为离散档位，`ZOOM_STEP = 1.2`，`scale=1` 为 0 档；工具栏显示 `0` / `+N` / `-N`。滚轮**直接缩放，无需 Ctrl**，pan 只走中键/Space+左键。工具栏移除了"回到原点"按钮。

---

**2. 原图渐进加载（额外优化，原计划未含）**

原文档：`CanvasItemNode` 只用 `serendip://thumb/<id>`（"先用 thumb，原图等阶段 4"）。

**实际落地**：阶段 2 就实装了原图渐进加载：
- 两层渲染：thumb 始终存在作底层，全图层预加载完成后淡入覆盖（`canvas-fadein` 0.4s keyframe）
- 错开加载：`index × 150ms` 防止 I/O 并发冲击
- 协议层修复：`serveFullImage` 的 `Cache-Control` 由 `no-cache` → `max-age=3600`

原因：画布目标是沉浸欣赏，缩略图用于占位的时间应尽量短。

---

**3. 视频元素提前显示缩略图（原计划阶段 3 才做）**

原文档：`CanvasItemNode` 对 `item.fileType === 'video'` 早退 `return null`。

**实际落地**：移除早退，视频也显示 `serendip://thumb/<id>` 第一帧缩略图（不播放）。完整视频播放逻辑仍留阶段 3 实现。

---

### 踩坑记录

无新踩坑。阶段 2 执行较顺畅，主要变动来自用户交互优化需求（缩放档位、原图加载）而非预期外的技术障碍。
