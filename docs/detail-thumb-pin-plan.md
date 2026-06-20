# 详情页 · 缩略图锁定（钉住图位）开发计划

> 状态：设计定稿，待实现。
> 命名约定：本特性在**代码里**统一用 `pin / pinned / togglePin`，以避免与既有「锁定模式」
> （双击大图进入的 pan/zoom 沉浸态 `lockState` / `LockViewport`）撞名；**UI 文案与图标**
> 仍按用户期望用「锁定」+ lucide `Lock` 图标。

## 1. 目标 UX

在详情大图页底部的缩略图条上：

- **双击任意缩略图** → 把该「图位」锁定（pin）。锁定的缩略图右上角叠加一个 lucide `Lock` 图标。
- 锁定后，**无论之后怎么接力新增**，该图位都固定显示这张锁定图、停在**原视觉位置不动**；
  它**右侧的未锁定缩略图在接力时往左移动会「跳过」这个锁定位**（绕过它流动）。
- **回滚（prev）到该位**，大图显示这张锁定图；此时**双击大图**进入沉浸态查看的也是这张图。
- **再次双击该缩略图** → 解锁。解锁后若不接力则原地不动；一旦再接力新图，它就回归**正常逻辑**
  （被它右侧的图替代、参与左移/离场）。
- **可同时锁多张**。每个锁定位**占用 6 格窗口中的一格**。
- **若 6 格全被锁满**（没有空闲未锁定格容纳接力新图）→ **不接力**（`next` / 选推荐 / 自动预取都不再带入新图）。
  用户对自己的锁定行为负责，不做额外提示（可选：轻微无反馈即可）。

## 2. 为什么要改数据模型

当前 `stores/detail.ts` 是**线性 `sequence` + `cursor` + `maxCursor`** 模型：接力 = 往尾部 append、
头部按 `2×BUFFER_SIZE` 裁剪；缩略图条 `ThumbStrip` 自己维护一份 `entries` 动画态，靠
width 0↔52 的收/展 + flex 重排产生「整排左移」的观感。

这套模型无法干净地表达新需求：

1. **锁定位「停在原视觉位置」**：现状是按 `sequence` 顺序 flex 排布，离场项 width→0 会让整排重排，
   锁定项也会跟着漂移 —— 做不到「定在原格不动」。
2. **未锁定项「跳过」锁定位**：需要锁定格固定、未锁定流在其周围按槽位流动。
3. **锁定占名额 / 锁满停接力**：接力逻辑必须感知「还有没有空闲未锁定槽」，这是槽位级的判断，
   线性 append 表达不了。

关键事实：当前**可导航范围本就被窗口限死**（`prev` 下界 `maxCursor-(BUFFER_SIZE-1)`，即只能在
可见窗口的 ≤6 张内回滚）。所以可以把模型从「长 `sequence` + 游标」**重构为「可见槽位窗口 + 预取池」**，
语义等价、且天然支持锁定。重构面**仅限 `stores/detail.ts` 与 `views/Detail.tsx`**
（`Explore/Category/Liked` 只用到 `open`，不受影响）。

## 3. 新数据模型（`stores/detail.ts`）

把 `sequence / cursor / maxCursor / _jumpOnAppend` 重构为：

```ts
interface Cell {
  key: number          // 槽位内唯一自增 key（沿用 nextSeqKey），用于动画 FLIP 与去重
  item: MediaItem
  pinned: boolean      // 是否锁定
}

interface DetailState {
  isOpen: boolean
  cells: Cell[]        // 可见缩略图条，视觉左→右 = index 0..n-1，长度 ≤ BUFFER_SIZE
  cursor: number       // 指向 cells 的下标（当前大图 = cells[cursor]）
  pool: MediaItem[]    // 预取的「接力储备」，接力前进时从队首取
  scopePath: string | null
  scopeLocked: boolean
  fetching: boolean
  _pendingScopeJump: boolean   // 切 scope/选推荐后，待预取回来自动前进一张到新 scope
  // 操作见下
}
```

- `cells` ≈ 原 `sequence[trimStart..maxCursor]`（已访问可见窗口）。
- `pool` ≈ 原 `sequence` 中 `maxCursor` 之后的预取项（尚未带入的上游）。
- 前沿 = `cells.length-1`（不再需要 `maxCursor`）；回滚下界 = `0`。

> `BUFFER_SIZE=6 / FETCH_BATCH=8 / PREFETCH_THRESHOLD=2` 常量沿用。

### 3.1 接力前进的槽位变换（核心）

定义把「新图 `newItem` 接力进窗口」的纯函数（保持锁定格原位、未锁定流绕过锁定格）：

```
relayForward(cells, newItem) -> { cells', placedIndex } | BLOCKED
  newCell = { key: nextKey(), item: newItem, pinned: false }

  // 还没满：直接追加到最右，无人离场
  if cells.length < BUFFER_SIZE:
      return { cells: [...cells, newCell], placedIndex: cells.length }

  // 已满：回收「最左的未锁定格」，未锁定流左移并绕过锁定格
  unlocked = cells.filter(c => !c.pinned)            // 视觉顺序
  if unlocked.length === 0: return BLOCKED           // 全锁定 → 不接力
  queue = [...unlocked.slice(1), newCell]            // 丢最左未锁定，新图入队尾
  result = []; qi = 0; placedIndex = -1
  for slot in 0..BUFFER_SIZE-1:
      if cells[slot].pinned: result[slot] = cells[slot]          // 锁定格原位不动
      else: result[slot] = queue[qi]; if queue[qi]===newCell placedIndex=slot; qi++
  return { cells: result, placedIndex }
```

要点：
- 锁定格 `slot` 不变 → 动画上零位移（停在原位）。
- 未锁定格 `slot` 改变 → 动画左移，越过中间的锁定格（视觉「跳过」）。
- 离场者 = 被丢弃的最左未锁定格（动画淡出）。
- 新图落在「最右未锁定槽」`placedIndex`（通常即最右；若最右格被锁定则落在更靠左的未锁定槽）。

### 3.2 操作语义

- **`open(item)`**（网格点开，全新开始，沿用现有入口）
  `cells=[{key,item,pinned:false}]; cursor=0; pool=[]; scope=item.folder_path; scopeLocked=true;`
  `_pendingScopeJump=false;` 触发预取。

- **`next()`**
  - `cursor < cells.length-1` → `cursor++`（窗口内右移，可能落到锁定/未锁定格）。
  - 否则（在前沿）→ 接力前进：
    - `pool` 为空 → 本次不动 + 触发预取（等同现状 `newCursor>=length` 直接 return）。
    - 取 `item=pool.shift()`，跑 `relayForward(cells,item)`：
      - `BLOCKED`（全锁定）→ 把 item 放回 pool 队首、**不动**（不接力）。
      - 否则 `cells=cells'; cursor=placedIndex;` `pool` 低于阈值则预取。

- **`prev()`**：`cursor>0` → `cursor--`，否则不动。（窗口内回滚，含落到锁定格。）

- **`jumpTo(index)`**：`cursor=index`（缩略图单击跳转）。

- **`togglePin(key)`**：翻转 `cells` 中该 key 的 `pinned`。锁定不移动 `cursor`、不取数。
  解锁立即生效：该格回归未锁定流，下次 `relayForward` 可被回收。

- **`relayTo(item)`**（右侧推荐面板选图，沿用阶段刚修的「保留历史接力」语义，移植到槽位模型）
  - 切 `scopePath=item.folder_path; scopeLocked=true;` 清 `pool`。
  - 跑 `relayForward(cells,item)`（显式带入选中图，而非来自 pool）：
    - `BLOCKED`（全锁定）→ 整体 no-op（无法落位则连 scope 都不切；可选轻提示）。
    - 否则 `cells=cells'; cursor=placedIndex;` 触发预取（填充新 scope 的 pool）。

- **`setScope(path)`**（面包屑切范围，保留历史 + 锁定）
  `scopePath=path; scopeLocked=true; pool=[]; _pendingScopeJump=true;` 触发预取；
  预取回来后若 `_pendingScopeJump` → 自动跑一次 `next()`（接力前进到新 scope 第一张），清标志。
  （替代原 `_jumpOnAppend`。注意：若此时全锁定，`next` 会 BLOCKED，则停在原位、清标志。）

- **`close()`**：`isOpen=false`（不清 cells，沿用现状）。`open` 时整体重建即天然清掉锁定。

### 3.3 预取（`triggerPrefetch`）

逻辑基本照搬现有 `triggerPrefetch`，差异：

- 去重 `seenIds` = `cells.map(item.id)` ∪ `pool.map(id)`。
- 抽到的候选 **append 到 `pool`**（不再进 `sequence`）。
- 小目录循环 / 单图复制兜底逻辑原样保留（填进 pool）。
- 触发时机：`pool.length <= PREFETCH_THRESHOLD` 时补；`next` 前沿 pool 空时补。
- `_pendingScopeJump` 完成后的「自动前进一张」放在预取成功回调里触发。

## 4. 缩略图条动画重构（`ThumbStrip`）

从「flex 行 + width 收展」改为**绝对定位槽位 + FLIP 过渡**：

- 容器 `relative`，固定高度；每格 `position:absolute`，`left = slot*(THUMB_W_PX+THUMB_GAP_PX)`，
  容器宽度 = `n*(W+GAP)`，整体仍 `left-1/2 -translate-x-1/2` 居中。
- `ThumbStrip` 维护一份本地渲染表（按 `key`），每次 store `cells` 变化做协调：
  - **新进格**：起始 `opacity:0 / scale(.9)`，下一帧过渡到目标 `left + opacity:1`（淡入）。
  - **存活格**：`left` 过渡到新槽位（FLIP 左移）。**锁定格槽位不变 → 无位移**（自然「停在原位」）。
  - **离场格**：从 store `cells` 消失的 key 标 `leaving`，过渡 `opacity→0`（可叠 `scale`），
    `onTransitionEnd` 后从本地表移除（沿用现有「保留离场项到动画结束」的思路）。
- 过渡属性：`left, opacity, transform`（统一一个 `transition`），时长沿用现观感（~200ms）。
- **高亮**：`cells[cursor].key` 对应格加 `ring-2 ring-primary`（现状一致）。
- **锁定叠加**：`pinned` 格右上角渲染 `Lock` 图标（半透明圆底 chip），与暗化 tint 叠放，始终可见。
- **交互**：
  - 单击格 → `jumpTo(slotIndexOfKey)`。
  - 双击格 → `togglePin(key)`。
    （React 会先发两次 click 再发 dblclick；单击导致的 `jumpTo` 到被锁格本身无副作用，
    可接受；如需更干净可用「dblclick 置一个 `justToggledRef` 吞掉尾随 click」，与 MediaCard 长按吞 click 同套路。）

> 因为槽位由 `left` 绝对定位驱动、key 稳定，FLIP 能精确表达「锁定不动 / 未锁定绕过锁定位左移」，
> 这正是用户预期的「重新设计的动画」。

## 5. `Preloader`

改为预热 `pool.slice(0,2)`（接下来最可能接力到的上游图），图片走 `serendip://image/<id>`，逻辑不变。

## 6. 边界与回归清单

- 锁定当前格、锁定后回滚跨越锁定格、解锁后接力被正常替代 —— 均覆盖。
- 锁满 6 格：`next` / 选推荐 / 自动预取都 no-op；解锁任一格后立即恢复接力。
- 切 scope / 选推荐保留历史与锁定格（锁定的是「图」，跨目录仍钉住，符合「参考图」语义）。
- `open`（从网格点开）= 全新会话，锁定全清。
- 视频格同样可锁（锁定只针对缩略图位，与大图是图/视频无关）。
- 回归：阶段刚修的「从推荐面板接力到新目录后可回滚/点更早缩略图」在槽位模型下需复测仍成立。

## 7. 实施步骤

1. `stores/detail.ts`：引入 `Cell` / `cells` / `pool` / `_pendingScopeJump`，删除 `sequence` /
   `maxCursor` / `_jumpOnAppend` / `_appendItems`；实现 `relayForward` 纯函数与
   `open/next/prev/jumpTo/togglePin/relayTo/setScope`；重写 `triggerPrefetch` 填 `pool`。
   导出 `Cell`（替代 `SeqEntry`）、`BUFFER_SIZE`、`prefetchMore`。
2. `views/Detail.tsx`：
   - 顶层订阅由 `sequence`→`cells`；`currentItem = cells[cursor]?.item`。
   - `ThumbStrip` 改为绝对定位槽位 + FLIP；接 `cells/cursor/jumpTo/togglePin`；加 `Lock` 叠加 + 双击锁定。
   - `Preloader` 改吃 `pool`。
   - 推荐面板 `onOpen` 维持调用 `relayTo`（已是正确入口）。
3. `npm run typecheck:web` + `npm run lint`。
4. 自测（见下）。

## 8. 测试清单（实现后人工验证，勿自启动 app）

1. 接力数张 → 双击中间某缩略图：出现锁图标，该格停在原位。
2. 继续接力：右侧未锁定缩略图左移且**跳过**锁定格；锁定格内容/位置不变。
3. 回滚（←/滚轮）：能落到锁定格并在大图显示锁定图；在该格双击大图进入沉浸态仍是该图。
4. 再次双击该缩略图解锁：不接力时不动；接力一张后该格被右侧图替代（恢复正常左移/离场）。
5. 锁多张、直到 6 格全锁：再 `next` / 选推荐 / 滚动 → 不接力；解锁一格后立即恢复。
6. 面包屑切 scope / 选推荐换目录：历史与锁定格保留，新 scope 正常接力。
7. 回归：从网格点开为全新会话（无锁定）；视频格可锁。
```
