# 阶段 3：选择 + 变换（移动 / 8 手柄缩放 / 旋转）+ 视频元素 + 出视口暂停

> 状态：✅ 已完成
> 所属计划：[main.md](main.md)

---

## 原始计划

**目标**：单选/多选/框选；选中元素显示 8 手柄 + 旋转柄；移动/缩放/旋转跟手；锚点跟手柄走；视频元素渲染并接入完整性能管理（出视口 pause）。

**新建文件**：
- `src/renderer/src/stores/canvasSelection.ts`：见 main.md §3.4。
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

## 阶段 3 回顾（已完成，记录实际落地与原文档的出入）

### 设计变动

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

**7. 隐藏 Moveable 内置旋转柄，改用 CornerRotateOverlay（PureRef 风格角点感应旋转）**

原文档：使用 Moveable 内置 `rotatable={true}` + 顶部旋转柄（`rotationPosition="top"`）。

**实际落地**：内置旋转柄设为 `rotationPosition="none"`（CSS `.moveable-rotation { display: none !important; }` 双重保险），新增 `src/renderer/src/views/canvas/CornerRotateOverlay.tsx`：
- `window.pointermove` 实时检测鼠标到图片四角的屏幕距离，进入 [MIN_CORNER_GAP=10, ROTATION_RADIUS=16]px 环形区时注入全局 cursor 覆盖（`* { cursor: url(...) !important; }`）
- Cursor 图案为圆弧箭头 SVG（viewBox 1024×1024），按鼠标相对图片中心的 `atan2` 方向旋转，8 方位预生成 base64、按 45° 分档切换
- `container.pointerdown` capture 拦截（先于 Moveable/Selecto），拖拽期间直接修改 DOM `el.style.transform`，`pointerup` 后调 `onCommitRotation(totalDeltaRad)` 写入 store
- **已知遗留**：多选旋转的 zone 检测逻辑（单个 item 角点 vs AABB 角点策略）待修复

原因：内置旋转柄位置固定（顶部伸出），方向不随鼠标跟随；角点感应贴近 PureRef/Figma 手感，cursor 方向实时跟随鼠标位置。

---

**8. 自定义 resize cursor 替代 Moveable 默认方向 cursor**

原文档：沿用 Moveable 默认 cursor（`ew-resize` / `nwse-resize` 等轴对齐方向）。

**实际落地**：`MutationObserver`（`attributeFilter: ['data-rotation']`）+ `requestAnimationFrame` 在每次 Moveable 更新手柄位置后对所有 `moveable-direction` 元素注入 inline style cursor 覆盖；drag 开始时 `lockResizeCursor` 注入 `* { cursor: ... !important; }` 全局锁定，drag 结束时移除。Cursor 为双箭头 SVG（180° 对称），角度由手柄 `getBoundingClientRect` 中心相对元素中心 `atan2` 决定，旋转元素的手柄 cursor 自动跟随旋转。

---

### 踩坑记录

**踩坑 1：`useRef(null)` 返回只读 current**

`const containerRef = useRef<HTMLDivElement>(null)` 得到 `RefObject<HTMLDivElement>`，其 `current` 是只读的。在 callback ref 中赋值 `containerRef.current = el` 时 TypeScript 报错 `Cannot assign to 'current' because it is a read-only property`。

解决：改为 `useRef<HTMLDivElement | null>(null)` 得到 `MutableRefObject<HTMLDivElement | null>`，current 可赋值。

---

**踩坑 2：Moveable resize 手柄存在两类 DOM 元素，大命中区被 class 过滤遗漏**

问题：每个 resize 方向渲染两类元素——可见点 `moveable-control moveable-direction`（约 8px）和透明大命中区 `moveable-around-control moveable-direction`（约 20px）。自定义 hover cursor 初版仅匹配含 `moveable-control` 的元素，实际将 `around-control` 排除在外（后者才是接收 hover 事件的大区域），导致 hover 时仍显示 Moveable 默认 cursor，只有 drag 时全局 `!important` 才覆盖。

解决：改为只检查 `cls.includes('moveable-direction')`（两类元素共有），用 `VALID_DIRS = new Set(['n','ne','e','se','s','sw','w','nw'])` 按 `data-direction` 过滤旋转柄等非 resize 元素，对所有 `moveable-direction` 统一应用自定义 cursor。

---

**踩坑 3：MutationObserver 在 layout 前触发，`getBoundingClientRect` 返回过期/零值**

问题：`attributeFilter: ['data-rotation']` 回调在浏览器 layout 前触发（microtask 优先级）。此时调 `el.getBoundingClientRect()` 返回过期或全零值，`atan2` 计算出错、cursor 方向错误。

解决：`applyToHandle` 内包一层 `requestAnimationFrame()`，推迟位置读取到下一帧 paint 后。配合 `if (!el.isConnected) return` 防止元素卸载后报错。

---

**踩坑 4：hover cursor 与 drag cursor 存在 1-4° 角度偏差**

问题：初版 hover cursor 用 `DIR_BASE[dir] + rotDeg` 公式近似，drag 阶段 `lockResizeCursor` 用 `atan2(mouseY - cy, mouseX - cx)` 精确几何，两者存在 1-4° 肉眼可见偏差——hover 与 drag 切换瞬间 cursor 方向跳变。

解决：hover cursor 改为与 drag 完全一致的几何——rAF 后读取手柄 `getBoundingClientRect()` 中心 `(hx, hy)`，再 `atan2(hy - cy, hx - cx)` 计算角度。删除了 `DIR_BASE` 常量和 `justUpdated` WeakSet。

---

## 阶段 3 完成后交互清 bug（2026-06-18）

> 阶段 3 标记完成后又做了一轮多选/框选/平移的交互打磨。下面是 **CanvasView.tsx + CornerRotateOverlay.tsx 当前交互模型的真相**——逻辑互相咬合，改键盘/选择/拖拽相关代码前务必先读这一节，否则极易踩坏。

### Selecto ↔ Moveable ↔ per-item pointer 的分工（关键）

三者都监听 pointer，靠"谁先 `e.stop()` / 谁负责什么"分工：

- **Selecto `onDragStart`**：按在 Moveable 手柄（`moveableRef.current.isMoveableElement(target)`）、任意 `.canvas-item`、或 Space 平移中 → 一律 `e.stop()`，**只在真正的空白处才拉框**。这是"拖选中图时不再误拉出选区框 / 不再误吞新元素"的根因修复。
- **框选三模式**：`onDragStart` 时按修饰键定模式并快照起始选区——无修饰=替换 / Shift=加选 / Ctrl=减选；`onSelect` 里基于 `marqueeStartRef` 快照 + 当前覆盖集实时合成，`continueSelect={false}`。
- **整组拖拽不靠 Moveable 中央区**：`<Moveable passDragArea={true}>` 让 group 的 `.moveable-area` 中央区 `pointer-events:none`（否则它盖住选区 AABB 挡住范围内其他图的点选）。代价是不能从框内空白拖整组——改由 **per-item `onPointerDown` 手动 `moveableRef.current.dragStart(nativeEvent)`**（移动超 8px 才启动，避免误触）。
- **多选无修饰单击成员 → 收窄单选**：`onPointerDown` 里若按下的是已选成员则先不动选区；`onClick` 里用 `groupDragStartedRef`（>8px 启动整组拖才置 true）区分"拖了整组"（保持多选）与"只是点一下"（`select([id])` 收窄）。

### 收尾 click 不能清空选区的三个守卫 ref

容器 `onClick` 默认 `selectionClear()`。以下场景的收尾 click 必须跳过清空，各用一个 ref 守卫（消费后复位）：
- `selectoJustSelectedRef` —— 框选刚结束（`onSelectEnd` 置位）。
- `panJustEndedRef` —— Space+左键平移松手（pan `onPointerUp` 置位）。
- 元素自身 `onClick` 有 `stopPropagation`，不会冒泡到容器清空。

### 多选旋转：自定义刚体框（仿 PureRef）

Moveable 的 group 框是 AABB、旋转时只会撑大缩小、不跟着转。`CornerRotateOverlay` 在多选旋转期间：注入 `.moveable-control-box { opacity:0 }` 藏掉原生框 → 在容器里建一个 `border` 的 `frameEl`，把"旋转起点的整组 AABB"当刚体，中心绕选区中心旋转 + 自身 `rotate(total)` → 松手 commit 后移除、交还原生 AABB（静止态仍遵从原生）。**创建时即用初始 AABB 定位**（否则按下未拖动时框会停在容器左上角）。单选旋转无此框。

### CSS / cursor 踩坑

- **`--color-accent` 这个变量在 `main.css` 里不存在**（`CanvasItemNode` 选中 outline 也误用了它，一直靠 Moveable 框显示选中所以没暴露）。强调色变量是 **`--color-primary`**。
- **Moveable 手柄/线条颜色** 由其运行时注入的 CSS 变量 `--moveable-color`（默认 `#4af`）控制；它的 `<style>` 晚于 `main.css` 插入，同特异性下会盖过我们 → 必须 `.moveable-control-box { --moveable-color: var(--color-primary) !important; }`。
- **Space 平移 cursor 用全局 `* { cursor: … !important }` 注入**（`setPanCursor`，仿 `lockResizeCursor`），否则元素的 inline `cursor:'default'` 和手柄 cursor 会盖掉容器 cursor，hover 到元素上看不到手型。
