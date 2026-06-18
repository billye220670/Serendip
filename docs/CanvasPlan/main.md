# 画布模式（Canvas）开发计划

> 执行方：Sonnet。本文档是交接规格 + 分阶段 todo。
> 设计文档：`docs/stage8-canvas-design.md`（"做什么"），本文是"怎么落地"。**执行时以本文档为准**，设计文档作为意图参考。
> 流程：每阶段开发完 → 给出"本阶段测试清单" → 用户 `npm run dev` 人工测 → 通过则 `git commit && push` → 用户 `/clear` 上下文 → 下一阶段。

---

## 阶段状态总览

| 阶段 | 标题 | 状态 | 文档 |
|---|---|---|---|
| 阶段 1 | DB + IPC + 侧栏画布分组 + 当前画布机制 + 添加路径 | ✅ 已完成 | [stage1-completed.md](stage1-completed.md) |
| 阶段 2 | 画布主视图骨架 + 视口（pan/zoom/F 聚焦）+ 元素渲染 + 视口持久化 | ✅ 已完成 | [stage2-completed.md](stage2-completed.md) |
| 阶段 3 | 选择 + 变换（移动 / 8 手柄缩放 / 旋转）+ 视频元素 + 出视口暂停 | ✅ 已完成 | [stage3-completed.md](stage3-completed.md) |
| 阶段 4 | 键盘快捷键 + 撤销重做 + 方向键导航 + 原图加载 | ✅ 已完成 | [stage4-completed.md](stage4-completed.md) |
| 阶段 5 | 裁剪（矩形交互 → 多边形结果） | 🔲 待开发 | [stage5.md](stage5.md) |
| 阶段 6 | 摄影机手摇调试面板 | 🔲 待开发 | [stage6.md](stage6.md) |
| 阶段 7 | 边界 / 空态 / 性能收尾 | 🔲 待开发 | [stage7.md](stage7.md) |

---

## 0. 北极星与全局裁决原则（出现分歧时回此裁决）

1. **画布是绝对自由的二维平面**。任何系统约束（吸附、网格、对齐辅助）默认关闭，按需引入。
2. **手感优先**：pan/zoom/缩放锚点的输入响应是核心，宁可砍 feature 也不能让基础操作粘滞。
3. **图片和视频是同种"四边形元素"**，只是材质不同；变换 / 选择 / 裁剪 / 层级所有规则一致。
4. **当前画布机制是降低心智负担的核心**：进入即设定、单击即加入、Alt 强制 picker、双重视觉锚点。
5. **变换手柄引入 `react-moveable`（周下载 50 万+，成熟库）+ 配套 `react-selecto`**：自写 8 手柄 + 锚点映射 + 多选包围盒约 400~600 行有边界条件的几何，引入后 ~80 行配置；这是整个 v1 计划里 ROI 最高的依赖。其余能力在现有栈（React 18 + Zustand + dnd-kit + 原生 DOM/SVG）上落地。
6. **渐进增强**：v1 范围明确（设计文档 §8），编组 / 性能模式 / 内置预设 留给 v1.5；不做 v2 的画布内拖入 / 文字标注 / 导出。

---

## 1. 现有架构复用地图（务必先读）

### 1.1 三进程 IPC 契约（改动要同步三处）

`src/main/ipc/contract.ts`（真源）→ `src/main/ipc/handlers.ts`（`ipcMain.handle`）→ `src/preload/index.ts`（`ipcRenderer.invoke` + `contextBridge`）。任何新增 IPC 必须三处同步。本期新增**约 10 个画布 IPC**，**契约命名照搬 `categories` 风格**：`createCanvas` / `listCanvases` / `renameCanvas` / `deleteCanvas` / `reorderCanvases` / `addItemsToCanvas` / `removeItemsFromCanvas` / `updateCanvasItem` / `updateCanvasItems`（批量）/ `updateCanvasViewport`。

### 1.2 categories 模块是"画布"的最佳模板（直接照抄结构）

- `src/main/categories/index.ts`：CRUD + `reorderCategories`（事务重写 position）+ `addItemsToCategory`（`INSERT OR IGNORE`，dedupes）+ `removeItemsFromCategory`（事务批量）+ 友好中文 Error。**画布的 `src/main/canvases/index.ts` 几乎是照搬**——只是"分类"换成"画布"，加上 item 端的 `x/y/w/h/rotation/z/clip_polygon` 字段。
- `src/renderer/src/stores/categories.ts`：mirror 的 zustand store，`reorder`/`addItems`/`removeItem`/`removeItems` 走乐观更新避免闪烁。**画布的 `useCanvasesStore` 同款**。
- `src/renderer/src/components/CategoryList.tsx`：sidebar 列表 = `useSortable`（拖拽重排）+ 同时是 `useDroppable`（接受 media 拖入）。**画布侧栏列表完全复用这套**。
- 决策点：去掉 `UNIQUE(canvas_id, file_id)`——同一文件可在同一画布多次添加（设计 §6）。所以 `addItemsToCanvas` 不能用 `INSERT OR IGNORE`，要用普通 `INSERT`。

### 1.2a react-moveable + react-selecto（阶段 3 引入的核心依赖）

**为什么引入**：变换手柄（8 手柄 + 旋转柄 + 对侧锚点映射 + Alt 中心锚 + Shift 锁比 + 多选包围盒缩放/旋转）自写约 400~600 行有边界条件的几何代码。`react-moveable`（KaKao 维护，npm 周下载 50 万+）原生支持设计 §3.3–3.4 列的所有规则，配置约 80 行。**这是整个 v1 计划里 ROI 最高的依赖**。

**与现有架构的契合点**：
- HTML/CSS 渲染方案天然配合（不像 Konva 对视频不友好）
- 包装 DOM 元素，对 `<div>` 套 `<img>` / `<video>` 无感
- React 18 + zustand 集成简单（moveable 事件 → zustand action → 重渲染）
- 不冲突 dnd-kit（dnd-kit 管瀑布流拖入 pill，moveable 管画布内变换）

**配套库**：`react-selecto`（框选 marquee，同作者，配合 moveable 的选区管理）。

**阶段 1 不引**（先把 IPC/侧栏/添加路径打通），**阶段 3 引入并替换自写选择/变换逻辑**。

### 1.3 dnd-kit 现有 DndContext 在 App.tsx（直接复用）

- 一个 DndContext，PointerSensor 8px 激活。`active.data.current.type` 区分 `media` / `category`，本期加 `canvas` 类型。
- `pointerWithin` collision，media 拖动时若不在任何 droppable 内**返回 `[]`**（严格命中）。画布 pill 接收 media 拖入沿用同一规则。
- `DragOverlay` 用 `snapToCursor` 修饰器；多选拖时显示 count badge。**全部不动，直接复用**。
- 跨视图拖拽（Explore/Liked/Category → 画布 pill）天然可用，因为 DndContext 在最外层。

### 1.4 现有添加按钮位的扩展（不要新建组件）

- `MediaCard.tsx`：右下角 hover overlay 已有 ❤️ / 👎 两个按钮。**追加第 3 个"加入画布"图标**（icon 用 `lucide-react` 的 `Frame` 或 `LayoutDashboard`，待视觉评审）。复用现有 hover 显隐 + 多选模式隐藏的逻辑。
- `SelectionToolbar.tsx`：已有"加入分类"按钮和 `placement="top"` 的 `ContextMenu`。**追加"加入画布"按钮，picker 完全复用同一 `ContextMenu` 组件**。
- `views/Detail.tsx`：底部 overlay 行已有"喜欢 / 分类胶囊 / 全部分类搜索"。**追加"加入画布"图标**，picker 同款。

### 1.5 ContextMenu 组件（picker 完全复用）

`src/renderer/src/components/ContextMenu.tsx` 已支持 `divider` / `header`（非可点击 group label）/ `placement: 'cursor' | 'top'` / `createPortal` 到 body 逃 sticky 上下文。**画布 picker（"加入画布"按钮单击 / Alt+点击）100% 复用**——构造 items 数组传入即可。

### 1.6 评审视图的"分类胶囊 + getFileCategoryIds 高亮"成熟模式

`views/Review.tsx` 底部分类胶囊那套（取当前图已属、即时切换、乐观更新）是画布"加入画布"按钮的**视觉/交互参考**，但 picker 用 ContextMenu 弹出而不是常驻胶囊（画布按钮位置紧）。

### 1.7 视频协议与播放池（画布的视频不接卡片那套池子）

- 取流：`serendip://video/<id>`（HTTP Range 已实现）。**不要**新增 IPC。
- `MediaCard.tsx` 的 `playingVideos` 池上限 3、8s watchdog —— 那是给瀑布流 hover 预览用的。**画布有自己的视频生命周期管理**（IntersectionObserver + 视口尺寸阈值，详见阶段 2）。
- 画布视频默认 `muted loop`；选中 / hover 强制播；出视口 `pause()` + 用 poster `<img src="serendip://thumb/<id>">` 替代节点（更轻）。

### 1.8 路由与视口持久化

- `useLibraryStore.view` 是主 pane 路由：现有 `{kind:'explore'}` / `{kind:'category', id}` / `{kind:'liked'}` / `{kind:'review'}`。**新增 `{kind:'canvas', id}`**。
- 进入画布 → 自动设置 `currentCanvasId = id`（设计 §2.4）。currentCanvasId 是渲染层 store 状态（非持久化），但每张画布的视口位置（pan/zoom）持久化到 `canvases` 表的 `viewport_x/y/scale`。
- 切走画布时 debounce 写回视口（避免每次 pan 都写库）；切回时从表读出恢复。

### 1.9 DB 迁移与 path LIKE 约定

- 当前 schema 版本 = 3。**本期 migration 4** 新增 `canvases` + `canvas_items` 表。已应用迁移**永远不动**，新加 `{version: 4, up: ...}`。
- 本期不需要 `path LIKE` 模糊查询（画布按 file_id 关联），所以 `escapeLike()` 这次用不到。但若未来在画布做"按路径过滤已加入"功能记得复用。

### 1.10 自绘标题栏 / Header / SettingsPopover

- 顶栏自绘（WCO），侧栏 `top-64`。**header chip"当前: 『XXX 画布』"放在 header 右侧**，gridSize 切换按钮**左边**——参考既有 SettingsPopover 风格。
- 工具栏沿用 `bg-glass backdrop-blur-xl` 玻璃质感（`--color-glass` 在 `assets/main.css`）。

---

## 2. 数据与 IPC 改动汇总（按阶段集中）

| 改动 | 位置 | 阶段 |
|---|---|---|
| migration 4: `canvases` + `canvas_items` 表 | `src/main/db/index.ts` | 1 |
| `src/main/canvases/index.ts` 整套（CRUD + items + viewport） | 新建 | 1 |
| 10 个画布 IPC（contract + handlers + preload 三处同步） | `src/main/ipc/*` + `src/preload/index.ts` | 1 |
| `useCanvasesStore`（mirror canvases 表）| `src/renderer/src/stores/canvases.ts` | 1 |
| `useCurrentCanvasStore`（全局 currentCanvasId）| `src/renderer/src/stores/currentCanvas.ts` | 1 |
| `useCanvasItemsStore`（当前画布的 items）| `src/renderer/src/stores/canvasItems.ts` | 2 |
| `useCanvasViewportStore`（pan/zoom 状态）| `src/renderer/src/stores/canvasViewport.ts` | 2 |
| `useCanvasSelectionStore`（独立于瀑布流多选）| `src/renderer/src/stores/canvasSelection.ts` | 3 |
| 引入 `react-moveable` + `react-selecto` | `package.json` + `npm install` | 3 |
| 无 schema 改动（v1.5 才加 `parent_id` / `group_id`） | — | — |

> 设计文档 §6 列的 schema 字段名为准；`clip_polygon` 在 stage 5 才写入，但 column 在 stage 1 就建好（避免后续迁移）。

---

## 3. 关键 Store 设计草图

### 3.1 `useCurrentCanvasStore`（stage 1）

```ts
interface CurrentCanvasState {
  currentCanvasId: number | null
  setCurrent(id: number | null): void
}
```

- 进入 `view = {kind:'canvas', id}` → `setCurrent(id)`
- 新建画布成功 → `setCurrent(newId)`
- header chip 的 ✕ → `setCurrent(null)`
- 不持久化（用户 reopen app 后 `null`，第一次"加入画布"自动弹 picker，符合设计 §2.4 的降级逻辑）

### 3.2 `useCanvasItemsStore`（stage 2）

```ts
interface CanvasItemsState {
  canvasId: number | null              // 当前加载的画布 id
  items: CanvasItem[]                  // 已加载的元素列表
  load(canvasId: number): Promise<void>
  unload(): void                       // 切走画布时调用
  // 增删 / 局部更新 / 批量更新（移动/缩放后批量 flush，详见 §3.5）
  addItems(fileIds: number[]): Promise<void>     // 自动布局算位置
  updateItems(patches: ItemPatch[]): void        // 乐观更新 + debounce flush
  removeItems(itemIds: number[]): Promise<void>
}
```

- `addItems` 用"下一个空位"算法（每次 append 时找最大 y + 行高，列瀑布式排）
- `updateItems` 是高频路径（拖动 / 缩放 / 旋转），**乐观更新本地 state + 250ms debounce 批量 flush 到 DB**（避免每帧写库）
- 切画布 = `unload()` 后 `load(newId)`

### 3.3 `useCanvasViewportStore`（stage 2）

```ts
interface CanvasViewportState {
  byCanvasId: Map<number, { x: number; y: number; scale: number }>
  get(canvasId: number): Viewport
  set(canvasId: number, vp: Viewport): void  // 同样 debounce flush
}
```

- 每张画布的视口独立，切走再切回画面停在原位
- 切走时 debounce flush 到 `canvases.viewport_x/y/scale`

### 3.4 `useCanvasSelectionStore`（stage 3）

```ts
interface CanvasSelectionState {
  selected: Set<number>                // canvas_item id（不是 file_id）
  anchor: number | null                // Shift-range 锚
  // 复用 stage 5 的"返回新 Set 触发更新"模式
  toggle(itemId: number): void
  selectRange(fromIdx: number, toIdx: number, items: CanvasItem[]): void
  selectAll(items: CanvasItem[]): void
  clear(): void
}
```

- **独立于瀑布流的 `useSelectionStore`**：画布选区生命周期跟瀑布流多选互不干扰（设计 §3.2）
- 选区基于 `canvas_item.id` 而非 `file_id`（同文件可在画布多份）

### 3.5 视口与元素的坐标系

- **世界坐标系**：每个 item 的 `x, y` 是中心点，`w, h` 是变换后的显示尺寸（旋转、缩放都已烘焙进去；`rotation` 是绕中心的弧度）
- **屏幕坐标系**：viewport `(x, y, scale)` 把世界坐标变换到屏幕。`screenPos = (worldPos - viewport.xy) * scale + canvasOriginInScreen`
- **光标锚点 zoom**：`wheel` 事件时计算 `worldUnderCursor = screenToWorld(cursor)`，`scale *= zoomFactor`，`viewport.xy = cursor / newScale - worldUnderCursor`（保持 `worldUnderCursor` 在屏幕上不动）
- **F 聚焦**：取选中（或全部）items 的 4 角变换后 AABB，求 min/max，scale = `min(viewW / aabbW, viewH / aabbH) * 0.9`，viewport.xy 居中

---

## 4. 关键决策（设计 §9 已与用户确认，定稿）

| 决策点 | 结论 |
|---|---|
| 同一画布同一文件多份 | 允许，去掉 UNIQUE，`addItemsToCanvas` 用普通 INSERT |
| 裁剪 v1 即做多边形 | 矩形交互 + Sutherland–Hodgman 求交，`clip_polygon` 存元素局部坐标，CSS `clip-path: polygon()` 渲染 |
| 视频性能管理 | IntersectionObserver + 屏幕占比阈值（5%）；出视口 `pause()` 并用 poster 替代节点；选中/hover 强制播；"全部静止"全局开关 |
| 手摇 v1 调试面板 | 暴露所有参数（位移/旋转/缩放各自振幅+频率+种子+总强度），localStorage 自存预设；用户调好后回收成内置预设（v1.5） |
| 画布数量不限 | 不加软上限 |
| 编组 / 解组 / 性能模式 | v1.5；本期 v1 不做 |
| 渲染方案 | HTML/CSS（每元素 `<div>` 内 `<img>` 或 `<video>` + `transform`）；不用 Konva（视频不友好） |

---

## 6. 明确不做（防 scope 蔓延）

- **编组 / 解组**：v1.5（设计 §3.7）。v1 用"多选 + 一起拖"作穷人版。
- **库素材直接拖入画布空白处**：v2。本期只能通过侧栏 pill / 卡片按钮 / 多选工具栏 / 详情按钮加入。
- **画布快照导出 PNG / 文字标注 / 自由曲线**：v2。
- **吸附 / 网格 / 对齐辅助线**：本期不做（设计北极星 §1）；用户需要再考虑。
- **`Shift + 方向` 加入选区**：v2。
- **内置手摇预设**：v1.5（用户调好后回收）。
- **侧栏 v1.5+ 功能**：搜索框 / folder 嵌套 / 宽度可调 / 图标态 —— 本 v1 计划不做（设计 §10），只做折叠 + 计数 + 自滚动。

---

## 7. 验收标准

打开画布的体验要"丝滑"——pan/zoom 跟手到位，缩放锚点指哪不动哪；从瀑布流单击"加入画布"按钮就在心里完成"先收着"的动作（不跳转、不打断）；进画布开始排版时，选择/移动/缩放/旋转零延迟；旋转后再裁能裁出八边形；视频出视口自动暂停不烧 CPU；调出心仪的手摇参数随手存为预设。所有路径在 500 元素以内顺畅，500+ 仍可用。
