# 画布模式（Canvas）开发计划

> 执行方：Sonnet。本文档是交接规格 + 分阶段 todo。
> 设计文档：`docs/stage8-canvas-design.md`（"做什么"），本文是"怎么落地"。**执行时以本文档为准**，设计文档作为意图参考。
> 流程：每阶段开发完 → 给出"本阶段测试清单" → 用户 `npm run dev` 人工测 → 通过则 `git commit && push` → 用户 `/clear` 上下文 → 下一阶段。

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

## 5. 分阶段开发计划

### 阶段 1：DB + IPC + 侧栏画布分组 + 当前画布机制 + 添加路径

**目标**：画布 CRUD 闭环；侧栏画布分组可见可重排；所有"加入画布"入口（卡片悬浮按钮 / 多选工具栏 / 大图详情 / 拖到 pill）通向同一个加入动作；header chip 显示当前画布；侧栏伸缩性 v1（折叠 + 计数 + 自滚动 + 顶/中/底布局）。**画布主视图先放占位**（`<CanvasView>` 显示"画布功能开发中"骨架），点击 pill 能切到该路由即可。

**新建文件**：
- `src/main/canvases/index.ts`：CRUD + `reorderCanvases` + `addItemsToCanvas`（普通 INSERT）+ `removeItemsFromCanvas` + `getCanvasItems` + `updateCanvasItem(s)` + `updateCanvasViewport`。中文友好 Error。
- `src/renderer/src/stores/canvases.ts`：mirror 表，`reorder`/`addItems`/`removeItems` 乐观更新。
- `src/renderer/src/stores/currentCanvas.ts`：全局 `currentCanvasId`。
- `src/renderer/src/components/CanvasList.tsx`：照抄 `CategoryList`，pill 是 `useSortable` + `useDroppable`。
- `src/renderer/src/components/CanvasPicker.tsx`：复用 `ContextMenu` 的 picker 工厂，含"+ 新建画布"项；接受 `placement` / `anchor` / `onPick(canvasId)` 回调；**统一所有"加入画布"按钮**调它。
- `src/renderer/src/views/CanvasView.tsx`：阶段 1 是占位 placeholder（"画布功能开发中" + 一个 `<button>新建画布</button>` 兜底）。
- `src/renderer/src/components/CurrentCanvasChip.tsx`：header 右侧 chip。

**改动文件**：
- `src/main/db/index.ts`：append migration 4。
- `src/main/ipc/contract.ts` / `handlers.ts` / `src/preload/index.ts`：10 个 IPC 三处同步。
- `src/renderer/src/App.tsx`：
  - 侧栏布局重整 → 顶部导航区（探索/喜欢/评审）+ 中间可滚区（分类组 + 画布组，各自折叠 + 内部滚动）+ 底部行动区（+ 新建 / ⚙ 设置）
  - `view.kind === 'canvas'` 路由分支
  - DnD: `media` 拖到画布 pill → `addItemsToCanvas`（多选时整组）
  - DnD: 新加 `canvas` 类型用于画布 pill 之间排序
  - 新建/重命名/删除画布的 `PromptDialog` / `ConfirmDialog`
- `src/renderer/src/components/MediaCard.tsx`：右下角追加"加入画布"按钮；点击 → `Alt 键 ? 强制 picker : 当前画布 ? 直接加 + toast : picker`。
- `src/renderer/src/components/SelectionToolbar.tsx`：追加"加入画布"按钮，同款分支逻辑。
- `src/renderer/src/views/Detail.tsx`：底部 overlay 追加"加入画布"图标，同款分支逻辑。
- `src/renderer/src/components/CategoryList.tsx`：抽出可折叠 section 通用结构（`<CollapsibleGroup title count children />`），分类和画布共用。
- `src/renderer/src/stores/ui.ts`：加 `categoriesGroupOpen` / `canvasesGroupOpen`（persist）。
- toast：项目内现尚无 toast 组件 → 新建轻量 `components/Toast.tsx`（fixed 底部居中，2.5s 自动消失，支持右侧 action 链接），全局放在 App。

**实现要点**：
- migration 4 schema 严格按设计 §6（`canvases` + `canvas_items`，**clip_polygon 字段在此就建出来**避免后期迁移；不加 UNIQUE）。
- `addItemsToCanvas(canvasId, fileIds)` 的"自动布局"在 main 还是 renderer？**放 renderer**：因为算位置依赖当前 viewport 的可视区，main 看不见；signature 是 `addItemsToCanvas(canvasId, items: {fileId, x, y, w, h, z}[])`。stage 1 的初始 x/y/w/h 用简单瀑布式（可视区中心列宽 240px，每张图按原始宽高比缩放，垂直 +12px 间距）—— 这个简单算法在 stage 1 落地，stage 2 加入"找最低空列" 优化。
- header chip 单击弹快速切换菜单（同 picker，但带"前往" / "清除当前"项）；✕ 直接清除。
- toast 在每次"加入画布"成功后弹出："已加入『XXX 画布』 [前往]"。点"前往"= `setView({kind:'canvas', id})`。
- 侧栏布局重整后**整个侧栏不滚动**，只有"分类组"和"画布组"内部滚动；探索/喜欢/评审固定顶部，新建+设置固定底部。
- 折叠状态默认：用户首次启动 `canvasesGroupOpen=false`（无画布时收起更整洁），分类组保持现行默认。
- Alt + 点击"加入画布"按钮 = 永远弹 picker（不改 currentCanvasId）。
- 拖动到画布 pill = 直接加，**不弹 picker**（拖目标即明确）。
- 拖动到画布 pill 后**不自动跳转**到该画布（保持心流）；但若 pill 是 `currentCanvasId` 当前的，按当前画布逻辑走 toast。
- 进入 `{kind:'canvas', id}` → `useCurrentCanvasStore.setCurrent(id)`。
- 新建画布对话框 `PromptDialog` 用现有组件，重名抛 main 的中文 Error，前端 `onConfirm` 返回错误字符串展示在对话框内。

**踩坑预警**：
- `addItemsToCanvas` 不能用 `INSERT OR IGNORE`（会丢"同图多份"），用普通 INSERT；事务包起来。
- `categories` 的 itemCount 是子查询，画布也要一样写法（不要在 `canvases` 表存计数，更新成本高）。
- `useDraggable` 的 data 字段加 `type: 'canvas'`；`App.tsx` 的 `handleDragEnd` 已按 `active.data.current.type` 分支，照样添。
- collisionDetection 已有 media 严格命中规则；画布 pill 是 droppable，落进 `pointerWithin` 命中即可，无需特别处理。
- 折叠组件的 `<details>` 原生标签虽然轻，但样式定制麻烦；用自写的 `<button + caret + section>` 模式（参考 SettingsPopover 已有的展开收起）。
- toast 同时多次触发要队列化（连续加 3 张图 → 显示一次"已加入 3 张" 而不是叠 3 个 toast；可在 store 层做 debounce 合并）。

**测试清单**：
1. 启动 app，侧栏底部出现"画布"分组，初始为空（折叠态 + "+ 新建画布"占位按钮）。
2. 点"+ 新建画布"，输入名字"灵感板"，回车 → 分组展开显示"灵感板" pill；header 右侧出现 chip"当前: 『灵感板』"；侧栏 pill 左侧有 accent 竖条。
3. 重名新建 → 对话框内显示中文错误，不关闭。
4. 切到探索瀑布流。卡片悬浮 → 右下角新增"加入画布"图标。点击 → toast"已加入『灵感板』"，**不跳转**；toast 右侧"前往"链接点击后跳到画布视图（占位页面）。
5. Alt + 点击同按钮 → 弹 picker 列出所有画布 + "新建画布"；选其他画布加入，**当前画布不变**（chip 仍是"灵感板"）。
6. 多选 3 张图（长按进多选 → Shift 框选）→ SelectionToolbar 出现"加入画布"按钮 → 点击直接加到当前画布，toast"已加入 3 张到『灵感板』"。
7. 大图详情底部新增"加入画布"图标，点击同样加入当前画布。
8. 拖一张图到侧栏"灵感板" pill → 加入；DragOverlay 显示 count badge（多选 >1 时）；不跳转；不弹 picker。
9. 在画布占位视图点"新建画布"按钮 → 同样可建。
10. 侧栏画布 pill 互拖 → 重排（lifted preview 跟手）；刷新后顺序持久化。
11. 右键画布 pill → 重命名 / 删除（删除走 ConfirmDialog 二次确认）。删除画布若是 currentCanvasId，chip 自动清除。
12. header chip 单击 → 弹快速切换菜单（含"前往" / "清除当前"）；✕ 清除当前 → 此后"加入画布"按钮单击弹 picker 而非直接加。
13. 侧栏分类组也做了折叠（caret + 计数），状态刷新后保留。画布多到 >10 时分组内部滚动，整体侧栏不滚。
14. 探索 / 喜欢 / 评审三个固定在侧栏顶部；"+ 新建" / "⚙ 设置"固定在底部，无论分组多长都不被挤走。
15. `npm run typecheck` 通过（node + web 两个 config）。

---

### 阶段 1 回顾（已完成，以下记录实际落地与原文档的出入）

#### 设计变动

**1. 加入画布按钮：胶囊双按钮取代 Alt+点击**

原文档设计：单个"加入画布"图标按钮，`Alt+点击` 强制弹 picker，普通点击走当前画布/自动新建逻辑。

**实际落地**：改为胶囊式双按钮（`rounded-full overflow-hidden` 容器内两个 `<button>` + `w-px` 分隔线）：
- 左半（`Presentation` 图标）：直接加入当前画布；无当前画布时自动新建并设为当前
- 右半（`ChevronUp` 图标）：展开 CanvasPicker 面板（有状态，打开时高亮）

原因：Alt+点击在触控板上不直观，且单按钮无法传达"有两种操作"的视觉提示。胶囊设计更清晰。

**影响**：`Alt+点击 = 强制 picker` 的逻辑已删除，不再支持。`CanvasPicker` 的 `triggerRef` prop 用于避免点击触发器时先关闭再打开的 race condition（详见踩坑 #2）。

---

**2. 侧栏分类组不做折叠**

原文档设计：分类组和画布组各自有 caret 折叠、计数、`categoriesGroupOpen`/`canvasesGroupOpen` persist 到 ui store。

**实际落地**：分类组保持展开，无折叠 caret；`categoriesGroupOpen`/`canvasesGroupOpen` 未加入 ui store。画布组改为侧栏底部固定的 `CanvasPopover` 按钮（点击展开浮出面板），而非内嵌在侧栏中间滚动区的列表组。

原因：分类数量通常较少，折叠带来的复杂度不值；画布作为"当前工作画布"概念，更适合类似工具栏的底部常驻按钮+弹出面板，而非侧栏列表项。

**影响**：`CategoryList.tsx` 没有抽出 `<CollapsibleGroup>` 通用结构（原文档要求分类和画布共用）。CanvasPopover 是 App.tsx 内的局部组件，不是独立的 `CanvasList.tsx` 样式列表（`CanvasList.tsx` 文件存在但用于其他用途）。

---

**3. header chip 不弹菜单，直接前往画布**

原文档设计：chip 单击弹快速切换菜单（含"前往" / "清除当前"项）。

**实际落地**：chip 单击直接切换到该画布视图（或切回上一个视图）；chip 右侧 ✕ 按钮清除当前画布。没有下拉菜单。

原因：菜单层级增加操作步骤，直接 toggle 更快。

---

**4. CanvasPopover 取代 CanvasList 侧栏分组**

原文档设计：侧栏中间区新增"画布"折叠分组，内部滚动列表用 `CanvasList.tsx`（照抄 `CategoryList`，pill 是 `useSortable` + `useDroppable`）。

**实际落地**：侧栏底部固定一个"画布"按钮，点击弹出 `CanvasPopover` 浮出面板（portal 到 body，含搜索框 + 画布列表 + 创建）。画布列表的拖拽重排和 media 拖入 pill 功能保留，但入口从侧栏内嵌改为浮出面板。

`CanvasList.tsx` 实际存在，但内容与 `CategoryList` 模式不同——是 `CanvasPopover` 内部渲染画布项的子组件，不是独立的 `useSortable` 侧栏列表。

---

**5. 加入画布图标统一为 Presentation，评审 tab 图标改为 Glasses**

原文档设计：图标用 `Frame` 或 `LayoutDashboard`（待视觉评审）。

**实际落地**：所有画布相关按钮统一用 `Presentation`（lucide-react）；评审 tab 图标改为 `Glasses`（原为 `Star`）。`LayoutDashboard` 和 `Palette` 均已替换。

---

**6. 新增 Tooltip 组件，替换所有原生 `title=`**

原文档未提及。

**实际落地**：新建 `src/renderer/src/components/Tooltip.tsx`，通过 `cloneElement` 注入 hover 事件 + portal 渲染自定义样式 tooltip（`bg-sidebar border border-border text-foreground text-xs px-2.5 py-1.5 rounded-lg shadow-lg`）。替换了以下所有 `title=` 位置：
- MediaCard：新建画布并加入 / 加入当前画布 / 选择画布
- Detail：新建画布并加入 / 加入当前画布 / 选择画布 / 推荐（Tab）/ 收起推荐（Tab）/ 管理分类
- App：更换根目录 / 选择根目录 / 重新扫描 / 显示设置 / 新建分类（展开/折叠两处）/ 折叠侧栏 / 展开侧栏
- Review：撤销（Backspace）/ 跳过（Space）

---

**7. IPC 实际新增 12 个（文档预估 10 个）**

原文档预估 10 个画布 IPC。

**实际落地**：新增 12 个：`listCanvases` / `createCanvas` / `renameCanvas` / `deleteCanvas` / `reorderCanvases` / `getCanvasItems` / `addItemsToCanvas` / `removeItemsFromCanvas` / `updateCanvasItem` / `updateCanvasItems` / `updateCanvasViewport` / `getFileCanvasIds`。多出的 `getFileCanvasIds` 用于详情页判断当前文件已属于哪些画布。

---

#### 踩坑记录

**踩坑 1：CanvasPicker portal 事件穿透**

问题：CanvasPicker 面板渲染为 portal（`document.body`），但 React 的合成事件系统仍通过 fiber 树冒泡，导致面板上的点击/右键/滚轮穿透到底层瀑布流卡片（触发详情页打开、右键菜单等）。

解决：在面板根 div 上同时阻止五类事件：`onClick`、`onMouseDown`、`onPointerDown`、`onContextMenu`、`onWheel` 全部调用 `e.stopPropagation()`。缺一不可（漏 onContextMenu 会穿透右键，漏 onWheel 会穿透滚动）。

---

**踩坑 2：CanvasPicker 触发器 toggle 关闭 race condition**

问题：ChevronUp 按钮的 onClick 实现了"打开/关闭"切换（检查 `canvasPicker` state）。但 CanvasPicker 内部用 capture 阶段的 mousedown 监听点外关闭——capture 比 React onClick 先触发，导致每次点击触发器时：先 capture mousedown → 关闭面板 → 然后 onClick → 因 `canvasPicker` 已是 null 又重新打开，永远关不上。

解决：给 CanvasPicker 增加 `triggerRef?: React.RefObject<HTMLElement | null>` prop。capture mousedown 处理器内检查 `triggerRef.current?.contains(target)`，若命中则跳过关闭，让 onClick 自己处理 toggle。

---

**踩坑 3：长按卡片按钮意外触发多选**

问题：MediaCard 根节点监听 `onPointerDown` 起长按计时（500ms 进入多选）。喜欢按钮、MoreVertical 按钮、画布胶囊按钮的 `onPointerDown` 事件冒泡到卡片根节点，导致长按这些按钮也会触发多选。

解决：所有操作按钮加 `onPointerDown={(e) => e.stopPropagation()}`。

---

**踩坑 4：CanvasPicker `placement='top'` 高度变化时底部位置跳动**

问题：初始实现用 `top = y - height - margin` 定位面板（顶部对齐算法）。但面板高度随搜索结果数量变化（如输入新名称显示"+ 创建 xxx"按钮时），高度缩短导致底边上移，面板与触发器之间出现空隙。

解决：改用 CSS `bottom` 属性定位（`bottom = window.innerHeight - y + margin`）。底边固定在触发器上方，内容高度变化时面板向上生长，底边不动。

---

**踩坑 5：ContextMenu z-index 被 CanvasPopover 面板遮住**

问题：ContextMenu 原来 `z-[100]`，CanvasPopover 面板 `z-[150]`，导致在 CanvasPopover 面板内右键画布项时上下文菜单被面板盖住。

解决：ContextMenu 改为 `z-[200]`，确保始终浮在所有面板之上。

---

**踩坑 6：点击卡片稍微移动鼠标就触发详情页**

问题：`onMouseUp` 触发详情页打开，但用户在卡片上轻微移动鼠标（触控板轻扫）也会触发，非预期。

解决：改为 `onClick` 触发，并加移动距离守卫：记录 `pressStart { x, y }`，click 时计算与 release 位置的偏差，超过 `MOVE_CANCEL_PX = 8px` 则取消打开。

---


### 阶段 2：画布主视图骨架 + 视口（pan/zoom/F 聚焦）+ 元素渲染（图片）+ 视口持久化

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

### 阶段 2 回顾（已完成，以下记录实际落地与原文档的出入）

#### 设计变动

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

#### 踩坑记录

无新踩坑。阶段 2 执行较顺畅，主要变动来自用户交互优化需求（缩放档位、原图加载）而非预期外的技术障碍。

---

### 阶段 3：选择 + 变换（移动 / 8 手柄缩放 / 旋转）+ 视频元素 + 出视口暂停

**目标**：单选/多选/框选；选中元素显示 8 手柄 + 旋转柄；移动/缩放/旋转跟手；锚点跟手柄走；视频元素渲染并接入完整性能管理（出视口 pause）。

**新建文件**：
- `src/renderer/src/stores/canvasSelection.ts`：见 §3.4。
- `src/renderer/src/views/canvas/CanvasVideoNode.tsx`：视频专用 node（IntersectionObserver + 屏幕占比阈值）。

**改动文件**：
- `package.json`：`npm install react-moveable react-selecto`。
- `CanvasView.tsx`：单击选择逻辑；接入 `<Moveable>` 组件；接入 `<Selecto>` 组件（框选）；统一接入 KeyboardShortcuts（Esc 清空、Ctrl+A 全选）。
- `CanvasItemNode.tsx`：分发到 image / video 子组件；image 直接 `<img>`；video 走 CanvasVideoNode。给每个元素加 `data-canvas-item-id={item.id}` 属性（moveable 用它识别）。
- `CanvasToolbar.tsx`：加"全部静止（图片化）"全局开关。
- `useUiStore`：加 `canvasFreezeVideos: boolean`（persist）。

**实现要点**：
- **引入 react-moveable + react-selecto**：
  ```tsx
  import Moveable from 'react-moveable'
  import Selecto from 'react-selecto'
  
  // CanvasView.tsx 渲染：
  <Moveable
    target={selectedElements}  // 选中元素的 DOM ref 数组
    draggable={true}
    resizable={true}
    rotatable={true}
    origin={false}  // 对侧锚点（不是中心）
    keepRatio={true}  // 图片默认锁比
    renderDirections={['nw','n','ne','w','e','sw','s','se']}  // 8 手柄
    onDrag={e => { /* 更新 x/y */ }}
    onResize={e => { /* 更新 w/h/x/y */ }}
    onRotate={e => { /* 更新 rotation */ }}
    snappable={false}  // v1 不做吸附
  />
  
  <Selecto
    container={containerRef.current}
    selectableTargets={['.canvas-item']}
    hitRate={0}  // AABB 相交即入选
    onSelect={e => { /* 更新 selection store */ }}
  />
  ```
- **选择规则**（设计 §3.2 复用 stage 5 模式但独立 store）：
  - 左键单击元素 → 单选；点空白 → 清空（moveable 的 `onClick` / selecto 的 `onSelect`）。
  - Shift + 框选 → 加入既有选区（selecto `continueSelect` prop）。
  - Ctrl/Cmd + 单击 → toggle（`useCanvasSelectionStore.toggle`）。
  - Ctrl/Cmd + A → 全选；Esc → 清空。
- **Alt 中心锚 / Shift 锁比**：moveable 原生支持（监听 `e.inputEvent.altKey` / `e.inputEvent.shiftKey`，动态设 `origin` / `keepRatio`）。
- **多选包围盒**：moveable 自动计算整体包围盒；拖角缩放时每个子元素的 x/y/w/h 按比例变换（moveable `onResize` 事件的 `delta` 包含子项变化）。
- **视频元素的 IntersectionObserver**（同原计划）：
  - 每个 CanvasVideoNode 注册一个 IO，root = canvas 容器
  - `entry.isIntersecting === false` → `pause()` + 卸载 `<video>` 节点（保留 `<img src="serendip://thumb/<id>">` 占位）
  - `entry.isIntersecting === true` 且屏幕占比 > 5% → 挂载 `<video autoPlay muted loop>`；否则定格首帧
  - 选中或 hover 强制播；全局"全部静止"开关 = 一律 `pause()` + poster。
- **变换中性能**：moveable 的 `onDragEnd` / `onResizeEnd` / `onRotateEnd` 时才 flush 到 DB（拖动期间只改 zustand store）。

**测试清单**：
1. 左键单击元素 → 选中（4 周显示包围盒 + 8 手柄 + 顶部旋转柄）。
2. 左键空白 → 清空选区。Esc 同效。
3. 左键空白 + 拖 → marquee 矩形；松开后框内 AABB 相交的元素入选。Shift 加入既有选区。
4. Ctrl/Cmd + 单击 → toggle 该元素选中态；Ctrl/Cmd + A → 全选。
5. 拖右下角手柄 → 元素以左上角为锚点缩放；图片默认锁比。
6. 拖右下角手柄 + Alt → 元素以中心为锚点缩放（四向同时缩）。
7. 拖上边中点手柄 → 单轴缩放，下边中点为锚。
8. 拖角手柄 + Shift（对图片来说本就锁比，主要测对未锁比元素的强锁）→ 锁比。
9. 拖旋转柄 → 元素绕中心旋转；Shift 吸附 15°（0/15/30/45/...）。
10. 多选 3 张图 → 4 周显示整体包围盒；拖角缩放 → 整体等比缩；位置一致迁移；Shift 拆比例可拉变形（验证拆比开关）。
11. 多选旋转 → 整体绕包围盒中心转。
12. 拖动元素 → 跟手；松开后位置 flush 到 DB（重启 app 仍在原位）。
13. 加入一段视频 → 在视口内自动播放（静音循环）。
14. 缩到很远（视频屏幕占比 <5%）→ 视频暂停，显示静止首帧（`<img>` 替代）。
15. 视频拖出视口 → 暂停 + DOM `<video>` 卸载（验证 DevTools Elements）；拖回视口 → 重挂载 + 播放。
16. 选中视频 → 即使尺寸很小也强制播。
17. 工具栏点"全部静止" → 所有视频暂停显示首帧；再点恢复。
18. 多视频画布（如 5 个视频）滚动浏览不卡；CPU 不持续高位。
19. `npm run typecheck` 通过。

---

### 阶段 3 回顾（已完成，以下记录实际落地与原文档的出入）

#### 设计变动

**1. IntersectionObserver 观察目标通过 nodeRef prop 传入**

原文档：`CanvasVideoNode` 内部通过 `videoRef.current?.closest('[data-canvas-item-id]')` 找观察节点。

**实际落地**：`CanvasVideoNode` 增加了 `nodeRef: React.RefObject<HTMLDivElement | null>` prop，由父组件 `CanvasItemNode` 传入自己的根 div ref。

原因：`videoRef` 在 video 节点未挂载时为 null，无法用 `closest` 找到根节点；直接传 nodeRef 更可靠。

---

**2. 选区清空放在 unmount effect 而不是 unload 回调**

原文档未明确。

**实际落地**：`selectionClear()` 在 `CanvasView` 的 unmount cleanup 中调用（与 `unload()` 同位置），避免切换画布时选区残留在新画布。

---

**3. Selecto 的 container 用 useState + callback ref 而非 ref.current**

原文档：`container={containerRef.current}` 在 JSX 中直接访问 ref.current。

**实际落地**：改用 `containerCallbackRef`（同时更新 `containerRef.current` 和 `containerEl` state），Selecto 渲染时条件为 `{containerEl && <Selecto container={containerEl} />}`，绕过 lint 的 "Cannot access refs during render" 错误。

---

**4. F 聚焦支持选中子集**

原文档：F 聚焦对"选中（阶段 3 选中实装后再覆盖）"提了预期但未明确实现。

**实际落地**：阶段 3 直接实现了选中子集聚焦：`selected.size > 0` 时 fit 选中元素，否则 fit 全部元素。

---

**5. Moveable 坐标系设计：DOM 直改 + 结束时 flush**

原文档：用 react-moveable 事件的 dist/delta 反算世界坐标。

**实际落地**：拖动/缩放/旋转期间 Moveable 直接修改 DOM transform（不触发 React 重渲染，零延迟），结束事件（onDragEnd / onResizeEnd / onRotateEnd）时从 `lastEvent` 读取最终 dist，反算世界坐标 patch 后调用 `updateItems`（乐观更新 store，debounce 250ms flush 到 DB）。`el.style.transform = ''` + `moveableRef.current?.updateRect()` 让 React 重新接管。

---

**6. target={数组} 代替多个独立 Moveable**

原文档设计了 `targets` prop 用法，但具体实现未明确。

**实际落地**：使用 react-moveable v0.47+ 的 `target={HTMLElement[]}` 数组 prop（无 targets 复数），单元素时触发 `onDrag` 等，多元素时自动切为 Group 模式触发 `onDragGroup` 等。两组事件均实现。

---

#### 踩坑记录

**踩坑 1：`useRef(null)` 返回只读 current**

`const containerRef = useRef<HTMLDivElement>(null)` 得到 `RefObject<HTMLDivElement>`，其 `current` 是只读的。在 callback ref 中赋值 `containerRef.current = el` 时 TypeScript 报错 `Cannot assign to 'current' because it is a read-only property`。

解决：改为 `useRef<HTMLDivElement | null>(null)` 得到 `MutableRefObject<HTMLDivElement | null>`，current 可赋值。

---



**目标**：层级快捷键；Delete 移除元素；Ctrl+Z/Y 撤销重做；方向键智能 navigate；图片元素从 thumb 升级到原图（blur-up 或瞬切）。

**新建文件**：
- `src/renderer/src/stores/canvasUndo.ts`：命令栈。每条记录 `{ apply: () => Promise, revert: () => Promise }` 双向。容量上限 50。
- `src/renderer/src/lib/canvasNavigate.ts`：方向键最近邻算法（§3.9 余弦 + 距离）。

**改动文件**：
- `CanvasView.tsx`：键盘绑定（`[`/`]` 层级、Delete 移除、Ctrl+Z/Y 撤销重做、方向键 navigate）。
- `useCanvasItemsStore`：所有 mutator 同时 push 到 undoStack（除非显式 silent）。
- `CanvasItemNode.tsx`（图片分支）：升级为 thumb 兜底 + 原图覆盖瞬切（**复用 stage 1 详情页的成熟方案**，非 blur-up）。

**实现要点**：
- **层级**：每个 item `z` 是整数。`bringToFront(itemIds)` = 取 max(z) + 1, 2, ... 赋给选中；`sendToBack` 同理（min(z) - 1, ...）。`bringForward` 仅与上层一项交换 z；`sendBackward` 同理。flush 时只更新涉及的几条。
- **撤销**：每个动作（add/remove/move/scale/rotate/changeZ/clip）push 一条命令。move/scale/rotate 等连续动作以**一次 pointerdown→pointerup 的一整段**为粒度（"开始操作快照 → 结束 commit"），避免每帧塞栈。
- **方向键 navigate**（§3.9）：
  - 无选中：找最靠近视口中心的元素 → 选中（仅选中、不跳）
  - 有选中：取选区中心，按方向键 unit 向量取候选（cosθ > 0.5）+ 距离最近的元素
  - 切换后 pan 让新元素进入视口（但不强制 fit）：若已在视口内不动；不在则把它居中
  - 元素 `<input>` focus 时不响应（防干扰输入）
- **原图升级**：图片 `<img>` 起初用 `serendip://thumb/<id>`，同时后台加载 `serendip://image/<id>`（详情页阶段 1 已实装），onLoad 时换 src。**如果详情页阶段 1 还没做 image 协议**（实际查 `protocol.ts`），需要先把那块基础打通；本期文档假设已有。

**测试清单**：
1. 选中元素，按 `]` → 上一层；多按几次到顶。`[` 反之。Ctrl+Shift+]/[ 一键到顶/底。
2. Delete / Backspace → 选中元素从画布移除；库不变（探索瀑布流仍能看到）。
3. Ctrl+Z → 撤销刚才的操作（移动/缩放/旋转/层级/删除/添加）。Ctrl+Shift+Z 或 Ctrl+Y → 重做。
4. 连续 5 次操作后撤销 5 次，全部回到初始；再重做 5 次回到末态；中间任意时刻新增操作，重做栈清空。
5. 拖动一段（pointerdown→up 全程算一次）= 撤销栈一条；不会按帧塞 50 条。
6. 无选中按 → → 选中视口中心最近的元素；再按 → → 选中右侧最近的。
7. 选中元素按 ↓ → 选中下方最近的；选中后元素跑出视口时自动 pan 让它居中。
8. 按 → 时若视口右侧没有元素（cosθ 检查不通过），选区不变。
9. `<input>` focus（如重命名对话框）时按方向键不影响画布。
10. 大图片元素 thumb 先显示 → 原图加载后瞬切覆盖（无明显闪烁）。
11. `npm run typecheck` 通过。

---

### 阶段 5：裁剪（矩形交互 → 多边形结果）

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

### 阶段 6：摄影机手摇调试面板

**目标**：工具栏相机图标打开调试面板；面板暴露所有手摇参数；实时叠加在 viewport 上；自定义预设（localStorage）；用户调好后能复制 JSON 反馈给开发。

**新建文件**：
- `src/renderer/src/lib/simplexNoise.ts`：1D simplex noise（手写或挪用 ~30 行 MIT 实现）。
- `src/renderer/src/views/canvas/CameraShakePanel.tsx`：drawer / 浮动 panel；8 个滑杆 + 总强度 + 暂停按钮 + 复制 JSON / 另存预设 / 加载预设。
- `src/renderer/src/stores/cameraShake.ts`：当前参数 + 启停 + localStorage 自定义预设管理。

**改动文件**：
- `CanvasView.tsx`：在每帧 viewport 输出后**叠加**手摇 Δ（不写入 viewport 持久化）。用 `requestAnimationFrame` 持续刷；停用时归零、取消 RAF。
- `CanvasToolbar.tsx`：加相机图标按钮（toggle 调试面板）。

**实现要点**：
- **参数（设计 §4.2 表格）**：`posAmplitude` 0-50px / `posFrequency` 0.1-5Hz / `rotAmplitude` 0-5deg / `rotFrequency` 0.1-3Hz / `zoomAmplitude` 0-0.1 / `zoomFrequency` 0.05-1Hz / `noiseSeed` 任意 / `masterIntensity` 0-2。
- **算法**：3 个独立 noise stream（x/y/rot/zoom 各用不同 seed offset），按 `t * frequency` 取样，乘以 amplitude 和 masterIntensity，叠加到 viewport 输出矩阵后再变换元素。注意是叠加在**输出**层，不进 viewport store；停用归零即恢复。
- **手摇启用时禁用编辑**：选区清空 + SelectionOverlay 隐藏 + 拖动锁定（CanvasItemNode 的 pointerdown 不响应）。面板内"暂停"按钮临时停用以便操作。
- **复制 JSON**：把当前参数 stringify 到剪贴板，用户能直接粘到反馈里。
- **另存预设**：localStorage `serendip-shake-presets`，结构 `{ [name]: ShakeParams }`。下拉加载。
- **内置预设留空**：v1 调试面板不写死预设（用户调好后 v1.5 收）。

**测试清单**：
1. 工具栏点相机图标 → 调试面板浮出（drawer 或浮动 panel）；点 ✕ 关闭。
2. 调 posAmplitude=20px / posFrequency=2Hz → 画布开始抖动；停用 / amplitude=0 → 恢复静止。
3. rotation 抖动可见（轻微旋转）；zoom 抖动看到画面有缩放呼吸。
4. masterIntensity=0 → 完全静止；=2 → 强度翻倍（参数翻倍效果）。
5. 抖动期间拖动元素 → 不响应（编辑锁定）；选中状态被清空；点面板"暂停" → 暂时静止可以编辑，松开"暂停"恢复抖动。
6. 复制 JSON → 剪贴板粘出形如 `{"posAmplitude":20,"posFrequency":2,...}`。
7. 另存为预设"轻微手持"→ 保存到 localStorage；刷新 app，预设下拉里仍在；点击加载 → 参数恢复。
8. 关闭画布切到探索 → 抖动停止（取消 RAF）；切回画布默认不开抖动（除非用户再开）。
9. CPU 占用合理（抖动 RAF 持续 60fps，单核 <10%）。
10. `npm run typecheck` 通过。

---

### 阶段 7：边界 / 空态 / 性能收尾

**目标**：所有边界场景不崩；性能符合"<500 元素流畅"目标；删除 / 失效 / 取消等异常路径完整。

**改动文件**：
- `CanvasView.tsx`：空态提示完善（中央 + 箭头指向侧栏）；失效占位（is_missing → 灰色 placeholder + ⚠️）。
- `CanvasItemNode.tsx`：图片/视频加载失败 → 占位；失效文件不可裁剪/编辑（hover 提示"文件已失效"）。
- `useCanvasItemsStore`：处理被监听器（stage 7 watcher）标记 is_missing 的文件；不立即从画布移除（用户可能恢复文件），但显示占位。
- 性能优化：
  - 拖动期间用 `transform` GPU 加速（已是；确认所有 transform 都在 GPU 层）
  - 视口外的元素 `content-visibility: auto`（自带 lazy 渲染）
  - 大量元素（>200）时 SelectionOverlay 仅渲染选中那些的手柄（已是）

**实现要点**：
- **空画布**：中央"把图片或视频拖进来开始" + 一个示意箭头指向侧栏（CSS 画即可）。
- **失效元素**：监听 stage 7 watcher 标记的 is_missing 文件 → CanvasItemNode 渲染灰色占位（icon + 文件名 truncate）；hover toast "源文件已失效"；变换/裁剪入口禁用，仅可移动/删除。
- **大画布性能**：`content-visibility: auto` 让视口外元素跳过渲染计算。但 `intrinsic-size` 要写对（用 `w*scale` 估算）。
- **删除画布**：与删除分类一致，`ON DELETE CASCADE`（migration 4 已含）。删除当前画布 → currentCanvasId 清空 → header chip 消失 → view 回退到 explore。
- **连续添加 toast 合并**：1.5s 窗口内多次"加入画布"合并显示"已加入 N 张到『XXX』"（stage 1 已可能漏的细节，本期补齐）。

**测试清单**：
1. 删除画布所有元素 → 显示空态（中央提示 + 箭头）。
2. 在资源管理器删掉一张已加入画布的图（让 watcher 标 is_missing）→ 画布元素变灰显示占位 + ⚠️；hover 提示"源文件已失效"；可移动/删除元素，不可裁剪。
3. 损坏图（无法解码）→ 占位 + 错误图标，不崩溃。
4. 加入 200 张图的画布 → pan/zoom 流畅（60fps）；CPU/GPU 占用合理。
5. 加入 500 张图的画布 → 稍慢但可用；视口外的元素已跳过渲染（验证 `content-visibility`）。
6. 连续点 5 张图的"加入画布"按钮 → toast 合并为"已加入 5 张到『XXX』"（不是 5 个独立 toast）。
7. 删除当前画布 → currentCanvasId 清空，header chip 消失；view 回到 explore；侧栏画布列表少一项。
8. 多窗口边界（最大化 / 半屏 / 极小窗）画布 viewport 计算正确，元素位置不漂。
9. `npm run typecheck` 通过 + `npm run lint` 通过 + `npm run build` 通过。

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

