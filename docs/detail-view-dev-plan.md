# 详情页（沉浸欣赏页）开发计划

> 执行方：Sonnet。本文档是交接规格 + 分阶段 todo。
> 原始需求见 `C:\Users\billy\Desktop\原始需求文档.txt`，原型图见 `C:\Users\billy\Desktop\原型参考(和文档对应).png`。
> 本文档对原始需求做了架构落地、复用映射、阶段拆分与关键决策定稿。**执行时以本文档为准**，原始需求文档作为意图参考。

---

## 0. 北极星与全局裁决原则（出现分歧时回此裁决）

1. **大图是绝对主角**。任何 overlay 不得在欣赏态抢夺视觉重心。
2. **滚轮语义唯一 = 切换上/下一张**。本页不做 pan/zoom（与接力滚动冲突，已权衡放弃）。
3. **所有 overlay（a/b/e/f/g/h/i，d 除外）支持"专注态"统一淡出**，鼠标移动或按键唤回。
4. **逻辑干净优先**：后退 = 一键回原瀑布流；面包屑下钻**不计入任何导航/返回栈**。
5. **渐进增强**：AI/相似度是远期，本期 d 一律用现有通用随机算法（带范围收窄）。

---

## 1. 现有架构复用地图（务必先读）

### 1.1 三进程 IPC 契约（改动要同步三处）
`src/main/ipc/contract.ts`（真源）→ `src/main/ipc/handlers.ts`（`ipcMain.handle`）→ `src/preload/index.ts`（`ipcRenderer.invoke` + `contextBridge`）。
任何新增/修改 IPC 必须三处同步，否则渲染层 `window.api.*` 不过类型检查。渲染层直接从 `src/main/recommender` import `MediaItem` / `ExploreMode` 类型（编译期擦除，跨界 import 是有意为之）。

### 1.2 瀑布流 Masonry（直接复用，**详情页本身不用 masonry**）
- `src/renderer/src/views/Explore.tsx` / `CategoryView.tsx` / `LikedView.tsx` 三视图都用 `react-photo-album` 的 `MasonryPhotoAlbum`，列数走 `lib/grid.ts` 的 `getColumns(width, gridSize)`。
- 详情页是这些 masonry 之上的 **overlay**，不替换、不卸载它们（见 1.6）。
- d 推荐面板是**竖向 mini 流**，窄幅有限数量，**不要**用 MasonryPhotoAlbum 铺满（违背北极星）。简单竖向 flex 列即可。

### 1.3 MediaCard 与"普通单击"空位（详情页入口）
`src/renderer/src/components/MediaCard.tsx`：
- 当前普通单击（非多选、无修饰键）**无行为**，注释写着"尚无灯箱"。**详情页入口就接在这里**：`handleClick` 末尾，非多选/无修饰键时调用一个新的 `onOpenDetail?.(item)` 回调。
- 卡片已是 dnd `useDraggable`；拖拽阈值 8px。单击与拖拽已正确区分，不要破坏。
- 长按 500ms 进多选；这些都不受详情页影响。

### 1.4 喜欢 / 分类（tag）逻辑——直接复用
- **喜欢**：`window.api.setLiked(id, bool)`。视觉基准 = MediaCard 的心形（`bg-pink-500/90` 实心 / 描边）。`f` 必须与之统一。改 liked 后调 `loadStats()` 刷新侧栏徽章。
- **分类即 tag**：原始需求里的 g/h/i「分类/tag」就是现有 `categories`。可直接复用：
  - `listCategories()` → `Category[]`（含 `itemCount`、`position`，已按 position 升序）。
  - `getFileCategoryIds(fileId)` → 当前图已属分类 id 列表（评审视图已用，胶囊高亮靠它）。
  - `addItemsToCategory(catId, [fileId])` / `removeItemsFromCategory(catId, [fileId])`（事务批量，单个也走数组版）。
  - `createCategory(name)` → 新 id；重名抛中文 `Error`。
  - **多对多**：一图可属多分类，正是 g 胶囊多选所依赖。
- 评审视图 `Review.tsx` 已有一套"底部分类胶囊 + getFileCategoryIds 高亮 + toggleCategory"的成熟实现，**g 可大量照搬其交互与乐观更新写法**。

### 1.5 视频的坑（务必沿用现有方案）
- 取流只走协议：`serendip://video/<id>`，主进程 `thumbnailer/protocol.ts` 已实现 **HTTP Range 流式响应**（`<video>` seek / 秒开依赖它）。**不要**新增返回 buffer 的 IPC。
- 渲染层有全局播放池：`MediaCard.tsx` 里的 `playingVideos`（上限 3）、`videoCooldown`（error 才进冷却，看门狗超时不进）、8s watchdog。**那套是给瀑布流卡片 hover 预览用的**。
- **详情页的视频是单实例、用户主动观看**，不要接卡片那套池子。详情页自管生命周期：
  - 进入/切到某视频 → 挂载一个 `<video>`，带基础控制（播放/暂停/进度/静音/循环，原始需求 c 要求）。
  - **切走（上下一张 / 关闭详情页）立即 `pause()` 并卸载**，停止解码（原始需求"视频单实例播放，切走立即停止解码"）。
  - object-fit 用 `contain`（详情页是"品图"，**不是** Review/卡片的 `cover`）。

### 1.6 进入详情页时**不销毁瀑布流，仅覆盖其上**（关键约束）
- 原始需求收尾明确：进入详情页时不销毁瀑布流、仅覆盖其上并记录滚动位置；返回时原样揭开并恢复位置。否则 a 后退的"恢复滚动位置"会落空。
- **好消息**：当前布局滚动发生在 window/body 上（`aside` 与 `header` 都是 sticky，主区 `<main>` 内容随页面滚动）。因此 **详情页用 `fixed inset-0 z-50` 全屏 overlay 即可**——底下的 ExploreView/CategoryView/LikedView 保持挂载，滚动位置天然保留，关闭时直接揭开。
- 因此**不要**把详情页做成 `view` 的一种 kind（那会卸载瀑布流）。详情页状态独立存放（见 §3 store 设计），与 `useLibraryStore.view` 正交。

### 1.7 推荐算法（通用随机）——现状与改造点
- `src/main/recommender/index.ts` 的 `recommend({count, mode, excludeIds?, onlyUnrated?})` 是两级加权抽样，**当前只按 `settings.rootPath` 限定范围**（`path LIKE rootPrefix%`）。
- 详情页的 d 相关流 / c 接力队列需要"**按面包屑路径收窄范围**"。改造 = 给 `recommend` 加一个可选 `scopePath?: string`：当传入时，用 `escapeLike(scopePath)` 替换 rootPrefix 作为 LIKE 前缀（scopePath 必须仍在 rootPath 之下）。算法主体、模式参数、冷却全部不变——这就是原始需求说的"使用通用随机算法"。
- `escapeLike()` 已存在于 recommender（处理 Windows `\`、`%`、`_`）。务必复用，**所有 `path LIKE ? || '%'` 都要 `ESCAPE '\\'`**。

### 1.8 全分辨率图——当前缺口（本期新增）
- **当前只有 `serendip://thumb/<id>`（320px webp）和 `serendip://video/<id>`**。没有原图协议。Review 视图用 320px thumb + `object-cover` 糊弄"大图"，详情页的 `contain` 沉浸大图会糊。
- 决策（已与用户确认）：**新增 `serendip://image/<id>` 协议，直接服务原文件字节**。先用 thumb 做模糊占位，原图到达后淡入（blur-up）。
- 协议层（`thumbnailer/protocol.ts`）只是再加一个 `url.hostname === 'image'` 分支，**scheme 已在 `index.ts` 注册为 privileged，无需改注册**。
- **HEIC/HEIF 坑**：Chromium `<img>` **无法**渲染 heic/heif。原图字节方案对这两种格式失效。处理：image 分支里若扩展名是 `.heic/.heif`，**用 sharp 转码成高质量 webp/jpeg 再返回**（可顺手缓存到 `.serendip-cache` 下，文件名沿用 sha256 命名约定）。其余格式（jpg/png/webp/avif/gif/bmp）直接 `readFile` 原字节 + 正确 mime 返回。gif 必须返原图保留动图。

---

## 2. 数据与 IPC 改动汇总（全部集中在此，按阶段落地）

| 改动 | 位置 | 阶段 |
|---|---|---|
| `recommend` 增加 `scopePath?: string` 选项 | `recommender/index.ts` | 2 |
| `getRecommendations` 签名加第 4 参 `scopePath?: string` | contract / handlers / preload 三处 | 2 |
| 新增 `serendip://image/<id>` 协议分支（含 heic 转码兜底） | `thumbnailer/protocol.ts` | 1 |
| 无新增表、无 schema 迁移 | — | — |

> 智能子集（g）按用户决策走**简化启发式，不加表**：子集 = 当前图已属分类（必显）∪ 按 `itemCount` 降序的高频分类，截断到 6–8 个。复用现有 `listCategories` + `getFileCategoryIds`，无新 IPC。

---

## 3. 详情页状态设计（建议放在新 store：`stores/detail.ts`）

详情页是 overlay，与 `useLibraryStore.view` 正交。建议新建 `useDetailStore`（zustand，不持久化）：

```ts
interface DetailState {
  isOpen: boolean
  sourceView: View | null      // 进入前的视图，关闭时不需要 setView（没卸载），仅语义记录
  // 接力序列（c 与 d 共享同一队列，见 §4）
  sequence: MediaItem[]        // 已浏览 + 预取的相关图，按顺序
  cursor: number               // 当前大图在 sequence 中的下标
  scopePath: string | null     // 当前抽样范围（面包屑高亮层级）；null = rootPath 全局
  panelOpen: boolean           // d 推荐面板开关（e 控制，可记忆默认）
  // actions: open(item) / close() / next() / prev() / jumpTo(item) / setScope(path) / togglePanel() ...
}
```

- `open(item)`：`isOpen=true`，`sequence=[item]`，`cursor=0`，`scopePath = item.folder_path`（默认聚焦该图所在文件夹，§5 决策），随后异步预取一批填充 sequence 前方。
- `close()`：`isOpen=false`；底层瀑布流未卸载，滚动天然保留。
- **c 与 d 共享 `sequence`**：d 面板渲染的就是 `sequence` 中 cursor **之后**的若干项（向前预览），点 d 某项 = `jumpTo` 把 cursor 移到它。滚轮 next = cursor++，到序列尾部就按 scopePath 再抽一批 append。

---

## 4. 缓冲区（j）与接力队列设计（原始需求把此逻辑留给我们完善，此为定稿）

**模型**：维护 `sequence: MediaItem[]`（顺序的相关图序列）+ `cursor`（当前大图下标）+ 常量 `BUFFER_SIZE`（默认 6，本期写死常量，未来可设置化）。

**前进（滚轮下 / ↓ / 空格）**：
- `cursor++`。若 `cursor` 接近 `sequence` 末尾（如剩余 < 2），按当前 `scopePath` + `exploreMode` 调 `getRecommendations` 再抽一批，去重后 append。
- 预解码下一张（见性能约束），保证无白屏。

**回看（滚轮上 / ↑）**：
- `cursor--`，下限为 `max(0, 写过的最早可达位置)`。已浏览的图保留在 sequence 里可回滚。
- **回滚深度 = BUFFER_SIZE**：用户永远可往前回滚最多 6 位。超出缓冲窗口的更早历史可从 sequence 头部裁剪释放（控内存）。

**j 指示圆点**：
- 渲染 `BUFFER_SIZE` 个圆点（序列不足时显示已有数量）。
- 圆点代表"最近 BUFFER_SIZE 个位置的滑动窗口"；**高亮点 = cursor 在该窗口内的位置**。
- 当 cursor 在最新位置 → 高亮**最右**圆点（原始需求："往后滚完缓冲区再 push 进新图片，此时圆点应在最右侧"）。
- 每回滚一位，高亮点左移一格；前进则右移，已在最右时前进 = 窗口整体滑动、push 新图、高亮保持最右。

**边界**：当前 scopePath 下只有 1 张 / 无相关 → 接力流回退到上层目录补充（scopePath 取父目录重抽），仍无则回退全局 rootPath。d 显示空态。

---

## 5. 关键决策（已与用户确认，定稿）

| 决策点 | 结论 |
|---|---|
| 全分辨率图来源 | **直接服务原文件字节**（新 `serendip://image/<id>`），thumb 做 blur-up 占位；heic/heif 用 sharp 转码兜底 |
| g 智能子集"最近常用" | **简化启发式，不加表**：当前图已属 ∪ 高频(itemCount 降序)，截断 6–8 |
| 详情页入口 | **所有瀑布流视图**（Explore / Liked / Category）皆可进入，关闭回到进入前视图（overlay 未卸载，天然回到原位） |
| d/c 初始抽样范围 | **该图所在文件夹（`folder_path`），过少自动放宽到上层 / 全局** |
| i 新建分类 | **合并进 h 搜索面板**（原始需求强烈建议）：搜不到时回车 = 新建并归入当前图 |

---

## 6. 分阶段开发计划

> 流程：每阶段开发完 → Sonnet 给出"本阶段测试清单" → 用户 `npm run dev` 人工测 → 通过则 `git commit && push` → 下一阶段。
> 每阶段开工前先 `npm run typecheck` 确认基线干净；收工前必须 `npm run typecheck` 通过（node + web 两个 config）。

---

### ✅ 阶段 1：详情页骨架 + 沉浸大图(c) + 全图协议 + 进入/退出 + 后退(a)

**目标**：点任意瀑布流图片 → 全屏沉浸大图（清晰原图，fit-contain，深色背景）；Esc / 后退一键回原视图且滚动位置保留。视频能在详情页内播放并带基础控制，切走停止解码。

**改动文件**：
- `src/main/thumbnailer/protocol.ts`：新增 `image` 分支（原字节 + mime；heic/heif sharp 转码兜底）。
- `src/renderer/src/stores/detail.ts`（新建）：`isOpen` / `open(item)` / `close()`（本阶段先做这三个，sequence 用 `[item]` 占位）。
- `src/renderer/src/views/Detail.tsx`（新建）：`fixed inset-0 z-50` overlay。c 大图区（blur-up：先 `serendip://thumb/<id>`，原图 `serendip://image/<id>` onLoad 后淡入；视频走 `serendip://video/<id>` + `controls`，contain）。a 后退按钮（左上）+ Esc 关闭。进入/退出转场（整图缩放+淡入淡出，GPU 合成层 `transform`/`opacity`）。
- `src/renderer/src/components/MediaCard.tsx`：新增 `onOpenDetail?: (item) => void`，`handleClick` 普通单击时调用。
- `src/renderer/src/App.tsx`：根据 `useDetailStore.isOpen` 渲染 `<Detail/>`；给三个 masonry 视图的 MediaCard 透传 `onOpenDetail`（经各 View 的 render prop）。
- `Explore.tsx` / `CategoryView.tsx` / `LikedView.tsx`：把 `onOpenDetail` 透传给 `MediaCard`。

**实现要点**：
- 视频生命周期自管（§1.5）：切走/关闭 `pause()` + 卸载。
- 转场走 transform/opacity，避免主线程掉帧。
- 失效/损坏图：显示占位 + 提示，不崩溃（基础兜底即可，完整异常在阶段 6）。

**测试清单**（交给用户）：
1. 探索/喜欢/分类三个视图各点一张图，均能打开全屏大图，**图清晰**（非 320px 糊图）。
2. 大图按比例完整显示（contain），深色背景。
3. 视频图片打开后能播放，有控制条；点后退/Esc 后视频停止（任务管理器/CPU 不再占用解码）。
4. Esc 与左上角后退按钮都能关闭；**关闭后回到进入前那个视图，且滚动位置不变**。
5. （如有 heic 图）能正常显示。

---

### 阶段 2：滚轮接力切换(c) + 接力队列 + 缓冲区回看 + j 指示圆点 + 预加载

**目标**：在详情页滚轮/↑↓/空格切换上下一张；相关图按 scopePath 持续抽样接力；可回滚缓冲区；底部 j 圆点反映位置。

**改动文件**：
- `src/main/recommender/index.ts`：`RecommendOptions` 加 `scopePath?`；scopePath 存在时用它做 LIKE 前缀（仍校验在 rootPath 下）。
- `src/main/ipc/contract.ts` / `handlers.ts` / `preload/index.ts`：`getRecommendations(count, mode, onlyUnrated?, scopePath?)` 三处同步加参。
- `stores/detail.ts`：补全 `sequence` / `cursor` / `scopePath` / `next()` / `prev()` / 预取与去重（沿用 `seenIds` 思路）/ 缓冲裁剪逻辑（§4）。
- `views/Detail.tsx`：绑定 wheel / keydown（↑↓空格）；切换动效（纵向位移+淡入淡出）；j 圆点组件；预解码下 1–2 张（`new Image()` 预热或隐藏 `<img>`）。

**实现要点**：
- 滚轮防误触：节流/去抖一次切一张，避免一滚跳多张（连续滚动也要流畅不卡）。
- 缓冲窗口 = `BUFFER_SIZE`（默认 6 常量），回滚深度与圆点逻辑严格按 §4。
- scopePath 默认 = 打开那张图的 `folder_path`；本阶段范围固定该文件夹（面包屑切换留到阶段 3），过少则自动放宽到父目录 / 全局。
- 离开视口的大图位图及时释放，内存不常驻多张原图。

**测试清单**：
1. 滚轮向下：平滑切到下一张相关图（同文件夹/放宽后的相关图），无白屏。
2. 滚轮向上：能回看刚才浏览过的图，最多回滚 6 位。
3. ↑↓ 方向键、空格等效切换。
4. 底部圆点数量正确，位置随切换/回滚移动；滚到最新时高亮最右。
5. 连续快速滚动不卡死、不跳多张。
6. 文件夹只有 1 张时不报错（自动放宽取到相关图）。

---

### 阶段 3：面包屑(b) + 根上层灰化 + 范围收窄刷新

**目标**：顶栏显示当前大图路径的可点击 segment；点某段把 d/c 抽样范围收窄/扩大到该层级并原地刷新；根目录以上的 segment 灰掉不可点。

**改动文件**：
- `views/Detail.tsx`：面包屑组件。用当前图 `item.path`（或 `folder_path`）相对 `useLibraryStore.rootPath` 切分 segment。
- `stores/detail.ts`：`setScope(path)` —— 改 `scopePath`、重置 sequence（保留当前图为起点）、按新范围重抽接力队列。

**实现要点**：
- segment 来源：`folder_path` 去掉 rootPath 前缀后按路径分隔符切；rootPath 本身及其以上（如 `c:`、`\Users`）的 segment **视觉灰掉、不可点**（原始需求 b：用户绝不能点到 app 根目录以上）。
- 当前 scopePath 对应的 segment **高亮**。
- 面包屑下钻**不计入任何导航/返回栈**（a 仍是一键回瀑布流）。
- 路径过长自动换行，不得伸到被右侧 d 浮层遮挡的区域。

**测试清单**：
1. 面包屑正确显示当前图从 rootPath 起的各级目录。
2. 根目录以上的 segment 灰掉、点不动；根及以下可点。
3. 点某 segment：该段高亮，接力流/下一张范围相应收窄或扩大，原地刷新。
4. 切到不同目录的图时面包屑随之更新。
5. 后退仍是一键回原瀑布流（下钻没产生"返回栈"）。

---

### 阶段 4：相关推荐面板(d) + 开关(e) + 防抖刷新 + 骨架占位

**目标**：右侧 overlay 竖向 mini 流展示 scopePath 下相关图；Tab/按钮开关；滚动期不刷新，停稳 400–600ms 后防抖刷新并用骨架占位；点项即成为新大图。

**改动文件**：
- `views/Detail.tsx`：d 面板（`absolute` 浮在大图右侧之上，**不占位**，大图宽度恒定）。e 开关按钮（右上角，图标随状态切换，Tab 快捷键）。
- `stores/detail.ts`：`panelOpen` + `togglePanel()`；d 列表 = `sequence` 中 cursor 之后的项（与接力队列共享，§3 store）。点项 → `jumpTo(item)`。

**实现要点**：
- d 内容 = 接力队列向前的一段（6–8 张，滚动加载更多），**不是**铺满对比墙。
- 防抖：大图停稳 400–600ms 才刷新 d；滚动期间保持上次内容不闪烁；刷新时骨架/模糊占位，缩略图（`serendip://thumb`）到达淡入。
- 点 d 某项：它成为当前大图，c + 面包屑 + d 随之刷新。
- e 默认态可设默认收起（零成本）或默认浮出——用 `panelOpen` 初值控制，建议默认收起。
- **不做 hover 热区自动唤出**（避免误触）。

**测试清单**：
1. Tab / 右上角按钮切换 d 面板显隐，图标随状态变（收起态显"唤出"，展开态显"收起"）。
2. d 面板浮在大图右侧上方，大图宽度**不**因 d 出现而收缩。
3. 快速滚动切图时 d 不闪烁；停稳约 0.5s 后刷新，先骨架后淡入缩略图。
4. 点 d 中某张 → 它变成当前大图，面包屑/d 同步刷新。
5. d 内容与接力的"下一张"一致（共享队列）。

---

### 阶段 5：喜欢(f) + 分类胶囊(g) + 全部分类搜索面板(h，含 i 新建)

**目标**：左下角 f 喜欢即时切换（视觉同卡片心形）；g 智能子集胶囊（当前图已属∪高频，6–8）即点即切归属；h 搜索面板承载全量分类的搜索/勾选/键盘流，搜不到回车=新建并归入（合并 i）。

**改动文件**：
- `views/Detail.tsx`：底部 overlay 行——f（最左，实心红心/描边，右侧细线+padding 与 g 隔离）、g 胶囊区、h 入口按钮。
- `components/CategorySearchPanel.tsx`（新建）：轻量浮层（不离开详情页），顶部自动聚焦搜索框、输入即过滤、已属置顶打勾、↑↓选择、回车切换归属、搜不到回车新建并归入。
- 复用：`listCategories` / `getFileCategoryIds` / `addItemsToCategory` / `removeItemsFromCategory` / `createCategory`。

**实现要点**：
- f：`setLiked` 即时生效无确认；切换后 `loadStats()` 刷新侧栏徽章。视觉与 MediaCard 心形统一。
- g 子集算法：`subset = 去重([...当前图已属分类(按 listCategories 顺序), ...其余按 itemCount 降序]).slice(0, 7)`；已属=实心高亮，未属=描边；点击 toggle 即时生效（乐观更新，参照 Review.tsx 的 `toggleCategory`）。
- 切大图时 g 与 f 状态随当前图刷新（`getFileCategoryIds(currentItem.id)`）。
- h 全键盘流可用，无需鼠标；新建去重提示（名近似已有时提示"已有 #X #Y，确定新建？"，可本期做简单包含匹配提示，复杂同义判定不做）。
- 切换大图后 h 面板若开着应跟随当前图（或切图时自动关闭，二选一，建议切图自动关闭 h）。

**测试清单**：
1. 左下角喜欢点亮=实心红心、再点熄灭；侧栏"喜欢"数字同步变化。
2. g 胶囊只显有限个（≤8）；当前图已属的分类一定在内且高亮。
3. 点胶囊即时加入/移出当前图（切到该分类视图能看到结果）。
4. 点 h 打开搜索面板：输入即过滤；已属打勾置顶；↑↓+回车可纯键盘操作归属。
5. 搜一个不存在的名字回车 → 新建该分类并把当前图归入；侧栏出现新分类。
6. 切到下一张图时 f / g 反映的是新图的状态。

---

### 阶段 6：专注态 + 异常边界 + 性能打磨

**目标**：极致沉浸（淡出所有 overlay）；各类异常不崩溃可跳过；性能收尾。

**改动文件**：
- `views/Detail.tsx`：专注态（F 键 或 鼠标静止 3s）→ a/b/e/d/f/g/h/i 全部淡出，仅剩 c；鼠标移动或任意按键淡入。异常占位与提示。
- 视情况补 `stores/detail.ts` 的失效移除（文件被删/损坏 → 从 sequence 移除并自动切下一张）。

**实现要点（性能约束，Electron）**：
- 大图按显示尺寸解码；不在内存常驻多张原图位图，离开视口即释放。
- 接力预加载上限 1–2 张。
- d 缩略图走预生成缓存 + 骨架，停稳后单次加载；快速滚动期间零刷新开销。
- 视频单实例，切走立即停止解码。
- 转场走 GPU 合成层。

**异常边界**：
- 当前范围仅 1 张 / 无相关：d 空态；接力回退上层/全局。
- 文件被外部删除/移动：大图显示失效占位 + 提示，可从队列移除并自动切下一张（复用 `markUnavailable`）。
- 损坏/不支持格式：占位 + 错误提示，不崩溃，可跳过。
- 分类数量极多：g 智能子集 + h 搜索承接，布局不乱。

**测试清单**：
1. 按 F（或静止 3s）→ 所有 UI 淡出只剩大图；动鼠标/按键 → UI 淡回。
2. 把某张正在看的图在资源管理器里删掉后切到它 → 显示失效占位并能自动跳下一张，不崩溃。
3. 放一个损坏图 → 占位+提示，可跳过。
4. 长时间滚动浏览，内存不持续膨胀（无多张原图常驻）。
5. 整体顺滑：滚轮切图不卡、转场流畅。

---

## 7. 明确不做（防 scope 蔓延）

- 不做本页 pan/zoom 画布操作（与滚轮接力冲突，已放弃；细节查看的"双击/F 临时 100%"逃生口记 backlog，不进本期）。
- 不做 d 的 Pinterest 式常驻铺满对比墙。
- 不做逐层导航栈式后退（已定为一键回瀑布流）。
- 暂缓 CLIP/Tagger 相似度作为 d 的可切换来源（本期 d = 通用随机 + scopePath）。
- 暂缓 PureRef 式画布拼贴。
- 暂缓分类"最近常用"的真实 recency 追踪（本期用 itemCount 高频近似）。

---

## 8. 验收标准（原始需求）

打开详情页第一反应是"这张图真好看"，而非"下一张点哪个"。滚轮顺滑切图、毫无歧义；想归类时左下角一点即中、tag 再多也能秒搜；想发现下一站时 Tab 一下推荐温柔浮出；想极致沉浸时一键万物归寂。后退一键回瀑布流且滚动位置不变。
