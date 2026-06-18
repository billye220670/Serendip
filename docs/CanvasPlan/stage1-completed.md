# 阶段 1：DB + IPC + 侧栏画布分组 + 当前画布机制 + 添加路径

> 状态：✅ 已完成
> 所属计划：[main.md](main.md)

---

## 原始计划

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

## 阶段 1 回顾（已完成，记录实际落地与原文档的出入）

### 设计变动

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

### 踩坑记录

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
