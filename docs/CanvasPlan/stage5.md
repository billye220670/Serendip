# 阶段 5：裁剪（矩形交互 → 多边形结果）

> 状态：✅ 已完成（commit 91ada86）
> 所属计划：[main.md](main.md)
>
> ⚠️ **交互设计在开发时被用户改版，与下方原文档有重大出入。实际落地以文末「阶段 5 回顾」为准**，原文档保留作意图参考。

---

**目标**：双击元素 / 按 C 进入裁剪态；画布坐标系下的轴对齐裁剪框；Enter 确认裁剪、Esc 取消；旋转后的元素裁出多边形（如正方旋转 45° + 裁 = 八边形）；可重复裁剪。

**新建文件**：
- `src/renderer/src/views/canvas/CropOverlay.tsx`：裁剪态的 UI（裁剪框 + 4 角 4 边手柄；外侧暗色遮罩 cutout）。
- `src/renderer/src/lib/sutherlandHodgman.ts`：凸多边形求交（约 100 行）。
- `src/renderer/src/lib/clipMath.ts`：辅助 —— 把元素当前可见多边形（以局部坐标→世界坐标变换）→ 与世界裁剪矩形求交 → 转回局部坐标存到 `clip_polygon`。

**改动文件**：
- `useCanvasItemsStore`：`updateItem(id, { clip_polygon })`。
- `CanvasItemNode`：渲染时若有 `clip_polygon`，套 CSS `clip-path: polygon(p1 p2 ... pn)`（局部坐标百分比表示，相对 w/h）。
- `CanvasView`：双击元素 / `C` 键进入裁剪态；裁剪态下隐藏 8 手柄 + 旋转柄（避免冲突）；Enter / 点空白 = commit；Esc = 取消。

**实现要点**：
- **裁剪态生命周期**：`useCanvasSelectionStore` 加一个 `cropping: number | null`（正在裁剪的 itemId）。进入裁剪 → 清空多选只留这一项；退出 → 恢复正常选中。
- **裁剪框**：画布坐标系下的轴对齐矩形（即屏幕水平/垂直），不绕元素旋转。初始尺寸 = 元素当前可见 AABB 的 90%。
- **算法**：
  1. 取元素当前在世界坐标系下的可见多边形（最初是 4 角 矩形；若已裁过则是已存的多边形按当前 transform 变换到世界）
  2. 与裁剪矩形（世界坐标）求交 = 新的世界多边形
  3. 把新多边形**逆变换**回元素局部坐标（除以 w/h 得到 0-1 比例），存 `clip_polygon`
  4. 渲染时 CSS `clip-path: polygon(${p1.x*100}% ${p1.y*100}%, ...)`
- **重复裁剪**：步骤 1 取的"当前可见多边形"已含上次裁剪结果；再裁就是新矩形 ∩ 旧多边形 → 顶点更多。
- **裁剪态下禁用变换手柄**：避免拖手柄是变换还是改框的歧义；裁剪框自己有 8 个调节手柄（不带旋转柄）。
- **CSS clip-path 性能**：`<video>` 套 `clip-path: polygon()` 浏览器原生支持，性能好；不要再叠 SVG mask（多余）。

**测试清单**：
1. 双击图片 → 进入裁剪态；元素四周出现裁剪框（轴对齐）+ 外侧暗色遮罩；变换手柄消失。
2. 拖裁剪框的边/角 → 框尺寸改变；Enter → 提交，元素被裁剪（呈现为矩形子区域）。
3. 把图片旋转 45°，再双击进入裁剪 → 裁剪框仍是水平矩形（**不是**绕图旋转的）；Enter → 元素呈现为八边形（图四角被裁剪框切掉）。验证设计 §3.5 的核心需求。
4. 在已裁剪的八边形元素上再次进入裁剪 → 再裁一次 → 顶点变更多。
5. Esc 取消裁剪 → 框消失，元素回到裁剪前状态。
6. 裁剪后继续旋转/缩放/移动 → 多边形跟着变换（验证存的是局部坐标）。
7. 视频元素同样可裁剪（CSS clip-path 对 `<video>` 生效）。
8. 撤销裁剪（Ctrl+Z）→ 回到未裁状态。
9. 裁剪态下 8 手柄 / 旋转柄不显示；点其他元素不切换选区（裁剪态独占）。
10. `npm run typecheck` 通过。

---

## 阶段 5 回顾（已完成，记录实际落地与原文档的出入）

### 交互改版（最关键的出入）

原文档：双击元素 / 按 C 进入「裁剪态」→ 出现带 8 手柄的轴对齐裁剪框 + 外侧暗色遮罩 → Enter 提交 / Esc 取消，单元素裁剪。

**实际落地（用户改版，仿 PureRef）**：
- **按住 `C` 键 + 在画布上拖拽**画一个矩形（与框选同款主题色虚线框），松手即以该矩形为裁剪 AABB，对**当前所有选中元素**（支持多选）一次性裁剪。
- **无裁剪态、无 8 手柄、无暗色遮罩**——拖拽时用户心智已明确结果。
- **未选中任何元素时 `C` 无效**（按下 ignore）。
- 没有 Enter/Esc 提交/取消的概念：拖完即提交；拖拽过小（<4px）忽略。

### 裁后「封装到 AABB」+ 内容/操纵框解耦（核心难点）

原文档：保持元素 x/y/w/h/rotation 不变，把裁后多边形逆变换回元素**局部坐标**存 `clip_polygon`，CSS `clip-path` 渲染。

**实际落地**：用户要求裁后**操纵框立即适配为裁后形状的轴对齐 AABB**（如 1:1 图旋 45° 裁中心矩形 → 八边形，操纵框是八边形的 AABB）。这导致：
- 裁后外层框 = 可见多边形的**世界 AABB**，`rotation` 归零 → 操纵框轴对齐；后续旋转/缩放/移动逻辑与裁剪前完全一致。
- **但**简单地把 rotation 归零 + `objectFit` 填充会让图像内容也被错误转正（180° 倒置图变正立、45° 图内容转正）——用户实测到的 bug。
- **修复方案：图像内容与操纵框解耦**。`clip_polygon` 列改存 JSON `{clip, content}`：
  - `clip` = 可见多边形（外层框归一化 [0,1]² 坐标，给 CSS `clip-path`）
  - `content` = 图像在框内的旋转矩形放置（中心相对框中心的世界偏移 `cx/cy`、世界尺寸 `w/h`、相对框的旋转 `rot`）——保证裁后图像的世界放置/朝向/像素完全不变。
- 渲染：外层 `.canvas-item` 套 `clip-path: polygon(clip)`；内层 `.canvas-content` 包裹层按 `世界单位×scale` 的**像素**定位 + `rotate(content.rot)`（box-pixel 空间是世界的均匀缩放，旋转无畸变）。`<img>`/`<video>` 填充该包裹层。

### resize 拖拽期间内容实时同步

`clip-path` 是 `%` 单位、随外层框 width/height 自动缩放；但内容包裹层是像素定位、只在 React 渲染时更新。故 Moveable resize 直接改 DOM 尺寸时，若不处理则「只有 mask 缩、图不缩」。

解决：`CanvasView` 新增 `syncContentResize(el, w, h)`，在 `onResize` / `onResizeGroup` 每帧调用，按新框尺寸等比更新 `.canvas-content` 的 `width/height/left/top`（公式 `cw = content.w × width / item.w`，viewport scale 已含在 width 中）。resize 末端再用 `scaleClipContent` 把缩放烘焙进 `clip_polygon` 并入 undo。

### 与 CanvasView 既有交互系统的接入

`C` 裁剪是独立于 Selecto 的一套 pointer 交互（Selecto 只在空白处触发、且裁剪需能从任意位置起拖）：
- `cKeyHeldRef` 由 `window` keydown/keyup 维护（同 `spaceHeldRef` 模式），按下时注入 `crosshair` 光标。
- 新增容器级 crop-drag pointer effect（pointerdown/move/up + setPointerCapture），松手计算裁剪并 push undo。
- 三处守卫让 C 态独占：per-item `onPointerDown`、Selecto `onDragStart`、容器收尾 `onClick`（`cropJustEndedRef` 防止误清空选区）均在 C 态提前返回。
- 裁后**保留选中状态**（不 clear）+ `moveableRef.current?.updateRect()` 让操纵框立即适配。

### 实际改动文件

- **新建** `src/renderer/src/lib/clipPolygon.ts`：Sutherland–Hodgman 矩形裁剪 + 坐标变换 + `cropItem`（返回封装到 AABB 的 `{x,y,w,h,rotation:0,clipPolygon}`）+ `parseClipData` / `clipPolygonToCSS` / `scaleClipContent`。
- **改** `src/renderer/src/views/canvas/CanvasItemNode.tsx`：裁剪分支用 `.canvas-content` 包裹层按 content 渲染，外层套 `clip-path`。
- **改** `src/renderer/src/views/canvas/CanvasView.tsx`：`cKeyHeldRef` 等 refs、C 键 keydown/keyup、crop-drag effect、虚线框 JSX、三处守卫、resize 的 `syncContentResize` + `scaleClipContent`。
- **无 DB 迁移**：`clip_polygon` 是 TEXT 列，直接存更丰富的 `{clip, content}` JSON。

### 与原文档「不做/已变」对照

- ❌ 未建 `CropOverlay.tsx`（无裁剪态 UI）、未建 `sutherlandHodgman.ts` / `clipMath.ts`（合并进 `clipPolygon.ts`）。
- ❌ 无裁剪框 8 手柄、无暗色遮罩、无 Enter/Esc。
- ✅ Sutherland–Hodgman 多边形求交、旋转元素裁出多边形、重复裁剪累积顶点、视频可裁、Ctrl+Z 撤销——均实现。
- ➕ 额外：裁后封装到 AABB + 内容解耦 + resize 实时同步（原文档无此要求，是用户开发中追加的）。

### 已知小限制

- 无（resize 拖拽中图像实时跟随已修复）。

