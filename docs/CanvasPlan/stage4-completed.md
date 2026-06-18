# 阶段 4：键盘快捷键 + 撤销重做 + 方向键导航 + 原图加载

> 状态：🔲 待开发
> 所属计划：[main.md](main.md)

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
- **Delete 删除（后端已就绪，只差绑键）**：
  - 后端链路已全部接好：`removeItemsFromCanvas` IPC（contract/handlers/preload 三层）+ `useCanvasItemsStore.removeItems(canvasId, itemIds)`（乐观本地 filter）。
  - 在 `CanvasView.tsx` 现有的 `onKeyDown`（`window` keydown，已含 `<input>/<textarea>` 守卫、Space/F/Esc/Ctrl+A）追加 `Delete`/`Backspace` 分支即可：取 `Array.from(useCanvasSelectionStore.getState().selected)` → `removeItems(canvasId, ids)` → **删完必须 `selectionClear()` + `moveableRef.current?.updateRect()`**（否则 Moveable 仍持有已删 DOM 的旧 target，手柄残留/报错）。
  - **可撤销删除的坑**：`removeItems` 直接删 DB 行，`addItemsToCanvas` 是普通 INSERT（自增新 id）。要让 Ctrl+Z 复原删除，undo 命令必须**先快照被删 item 的完整行（含 id/x/y/w/h/rotation/z/clip）**，revert 时按原 id 重新插入——现有 `addItems` 路径不保 id，需要新增一个保 id 的恢复路径，或接受新 id（但会破坏选区/层级一致性）。建议设计 undo 栈时一并解决。
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
