# 详情页「锁定模式」（单图 pan/zoom 沉浸查看）开发计划

> 执行方：Sonnet。本文档是交接规格，**一次性开发完整功能**，不分阶段提交。
> 完成后运行 `npm run typecheck` + `npm run lint`，并输出测试清单给用户人工验证（本项目无 test runner）。
> UI 字符串与代码注释一律用中文，与现有代码保持一致。

---

## 0. 这是什么

详情页（`src/renderer/src/views/Detail.tsx`）当前的滚轮语义是"接力切换上/下一张"。本功能新增一个**临时叠加的"锁定模式"**：用户双击大图/视频后进入，把当前单张媒体变成一个**只支持 pan + zoom 的画布**（注意：不是项目里的"画布模式"，两者无关，这里只有 pan/zoom，没有多元素/选择/旋转）。目的是让用户快速沉浸放大查看当前这一张。

退出后回到详情页**原状态**——锁定模式纯粹是临时交互层，详情页本身的所有 React state / stores（cursor、面板开关、liked、分类等）**全程不动**，只是被一个 overlay 盖住，退出即卸载 overlay。

---

## 1. 交互规格（定稿，照此实现）

### 1.1 进入
- 图片**和**视频都通过**双击大图/视频区域**进入锁定模式。
- 视频双击必须 `e.preventDefault()` + `e.stopPropagation()`，屏蔽 Chromium `<video>` 的原生双击全屏。

### 1.2 锁定中的操作（全部对齐"画布模式"的操作习惯）
- **滚轮 = 以光标为锚点缩放**（不再切图）。沿用画布的离散档位算法：`ZOOM_STEP = 1.2`，`clampScale`（见 `src/renderer/src/lib/canvasMath.ts`）。
- **Pan**：严格**中键拖拽** 或 **空格 + 左键拖拽**（与画布完全一致，不支持纯左键 pan）。
  - Pan cursor 复用画布的手型光标：空格按下/可 pan 态用 `CURSOR_HAND_OPEN`，正在拖拽用 `CURSOR_HAND_GRAB`。通过注入全局 `<style>* { cursor: … !important }</style>` 实现（照搬画布的 `setPanCursor` 思路），退出锁定/松开时清除。
- **F 键 = 复位 zoom**（回到 fit/初始 1:1 居中），对齐画布的 F 复位，**不用双击复位**。
- 进入锁定后：详情页**所有 UI 隐藏**（顶栏、面包屑、缩略图条、f/h 操作区、加入画布胶囊、面板开关按钮），**推荐面板收起**（宽度→0）。**仅保留 WCO 系统按钮区**（窗口右上角，系统绘制，无需我们处理）。

### 1.3 退出
- `Esc` 退出锁定（**必须拦截**，不能穿透到详情页的"Esc 返回主页"逻辑）。
- 左上角按钮：复刻原"后退"按钮的样式与定位，但**图标由 `ChevronLeft` 换成 `X`（lucide-react）**，点击退出锁定。
- 退出后详情页一切原样恢复（仅卸载 overlay，stores/state 不变）。

### 1.4 进出引导动效
- 进入/退出时，媒体做一次轻微"放大→回原 / 回原→放大"的缩放脉冲 + 淡入/淡出，提示用户模式切换。
  - 进入：mount 时 `scale: 1.05, opacity: 0` → 下一帧 `scale: 1, opacity: 1`（CSS transition ≈ 0.28s ease-out）。
  - 退出：先进 `closing` 态 `scale: 1.05, opacity: 0`，约 220ms 后再真正卸载 overlay。
  - 该脉冲用一个**独立 wrapper 的 `scale` + `opacity` CSS 属性**实现，与内层 pan/zoom 的 `transform` 互不干扰（`scale` 是独立 CSS 属性，不会覆盖 `transform`）。

### 1.5 视频在锁定模式
- 视频**继续循环播放**（`loop autoPlay muted playsInline`，**不要**原生 `controls`）。
- 视频同样支持 pan/zoom。
- 底部提供**自定义进度控制条**：
  - **自动隐藏**：根据鼠标距窗口底部的距离阈值决定显隐——`pointermove` 时若 `window.innerHeight - e.clientY < ~140px` 则显示，否则隐藏；正在拖拽 seek 时**强制保持显示**。用 `opacity` + `pointer-events` 过渡。
  - **样式必须符合本 app 且亮暗自适配**：容器用 `bg-glass backdrop-blur-xl`，文字用 `text-foreground`，进度填充用 `bg-primary`（这些 token 已自动随主题变化，见 `assets/main.css` + `tailwind.config.js`）。
  - 内容：播放/暂停按钮（`Play`/`Pause` from lucide-react）、`mm:ss / mm:ss` 时间（复用文件内已有的 `formatDuration`）、可点击 + 可拖拽 seek 的进度轨道。
  - 进度用 `<video>` 的 `ontimeupdate` 驱动；seek 通过设置 `video.currentTime`。

---

## 2. 关键复用映射（务必先读，避免重复造轮子）

### 2.1 手型光标（抽公共模块）
画布 `src/renderer/src/views/canvas/CanvasView.tsx` 顶部定义了 `HAND_OPEN_PATHS` / `HAND_GRAB_PATHS` / `makeHandCursor` / `CURSOR_HAND_OPEN` / `CURSOR_HAND_GRAB`（base64 内联 SVG，hotspot 15,13）。

**重构动作**：把这几个常量+函数抽到新文件 `src/renderer/src/lib/handCursor.ts` 并导出 `CURSOR_HAND_OPEN` / `CURSOR_HAND_GRAB`（外加 `makeHandCursor` 备用）。
- `CanvasView.tsx` 改为从 `../../lib/handCursor` import，删掉本地定义（仅 hand 部分；resize cursor 留在画布，与本功能无关）。
- 锁定模式从同一模块 import。
- 改完确保画布 pan cursor 行为不变。

### 2.2 pan cursor 全局注入
画布 `setPanCursor(cursor | null)` 的做法：维护一个 `panCursorStyleRef` 指向插入 `document.head` 的 `<style>`，内容 `* { cursor: <hand> !important }`，传 `null` 时移除。锁定模式照搬一份**局部**实现即可（不必抽公共，逻辑短小；或抽也行，自行权衡）。退出锁定务必清除，避免泄漏到详情页。

### 2.3 zoom 数学
直接 import `clampScale` 和 `ZOOM_STEP`（`src/renderer/src/lib/canvasMath.ts`）。
- 离散档位：`currentLevel = Math.round(Math.log(s) / Math.log(ZOOM_STEP))`，`newScale = clampScale(Math.pow(ZOOM_STEP, currentLevel + delta))`，`delta = e.deltaY > 0 ? -1 : 1`。
- 光标锚点（让光标下的点保持不动）：设光标相对 viewport 容器坐标为 `cx,cy`，当前变换 `{tx,ty,s}`：
  ```
  const ratio = newS / s
  tx' = cx - (cx - tx) * ratio
  ty' = cy - (cy - ty) * ratio
  ```
  其中 pan/zoom 层用 `transform: translate(tx, ty) scale(s)` + `transform-origin: 0 0`。

> 注意：画布用的是 viewport `{x,y,scale}`（世界坐标系，元素不动相机动），本功能更简单——直接对媒体元素施加 `translate+scale` 即可，不必照搬画布的 viewport 世界坐标模型。两套坐标语义不同，**别混用公式**，按上面给的 `{tx,ty,s}` 版本算。

### 2.4 主题 token / glass
- 亮暗底色：详情页根容器已有 `isLight ? 'bg-stone-300' : 'bg-black'`，锁定 viewport 可复用同样底色。
- glass 进度条：`bg-glass backdrop-blur-xl`（`--color-glass` 亮=白 tint / 暗=黑 tint）。
- 主色：`bg-primary` / `text-primary`。
- 若需新增 `--color-*` 变量才记得去 `tailwind.config.js` 注册——本功能预计**无需**新增颜色 token。

### 2.5 现有图片加载兜底
图片层沿用 `ImageViewer` 的策略：先 `serendip://thumb/<id>` 盖底，`serendip://image/<id>` onLoad 后覆盖。锁定模式的图片也走这个，避免大图未到位时空白。视频走 `serendip://video/<id>`（HTTP Range 已支持 seek，见 `thumbnailer/protocol.ts`）。

---

## 3. 实现落点（集中在 Detail.tsx，外加一个 lib 文件）

### 3.1 新文件 `src/renderer/src/lib/handCursor.ts`
从 CanvasView 抽出的手型光标常量/函数（见 2.1）。

### 3.2 `Detail.tsx` — DetailView 主体
- 新增本地 state：`lockState: 'off' | 'on' | 'closing'`（`useState`）。
- 中央列（`relative flex-1 …` 那个容器）逻辑：
  - `lockState === 'off'`：渲染现有全部 UI（顶栏/面包屑/内容/缩略图条/操作区/胶囊/picker 等），**保持现状**。
  - 否则：渲染 `<LockViewport item={currentItem} closing={lockState==='closing'} onRequestClose={…} onClosed={…} />`，并隐藏其它 overlay。
    - 实现上最简洁：在 `off` 时正常渲染，进入锁定时额外渲染 LockViewport 盖在最上层（`z` 高于其它），并把其它 overlay 用条件 `lockState==='off' && (…)` 包起来不渲染。二选一，保证锁定时屏幕只有媒体 + X 按钮 +（视频时）进度条。
- 推荐面板：`<RecommendationsPanel open={panelOpen && lockState === 'off'} />`（保留用户的 open 偏好，仅在锁定时收起宽度——RecommendationsPanel 已是 width 动画收展，传 false 即收起）。
- `handleWheel`：开头加 `if (lockState !== 'off') return`（锁定时滚轮由 LockViewport 自己处理，不切图）。
- 键盘 `useEffect`：在锁定态优先处理——
  - `Escape`：若 `lockState !== 'off'` → 触发退出（进 `closing`，定时后 `off`），并 `return`，**不要 close 详情页**。
  - 锁定态吞掉 `ArrowLeft/Right/Space/Tab` 等切图/面板键（不调 next/prev/togglePanel）。注意：空格在锁定态用于 pan，由 LockViewport 内部监听；但详情页这层的 keydown 也要避免空格触发切图——直接在 `lockState!=='off'` 时 return 掉非 Esc 的键。
- 进入触发：给图片容器与视频容器（`<div className="w-full h-full flex items-center justify-center">` 内的 ImageViewer/VideoPlayer 外层）挂 `onDoubleClick`：
  - `e.preventDefault(); e.stopPropagation(); setLockState('on')`。
  - 注意视频原生双击全屏必须被 preventDefault 掉。
- 退出收尾：定义 `requestCloseLock = () => setLockState('closing')`；LockViewport 播放完退出脉冲后回调 `onClosed` → `setLockState('off')`。或在 DetailView 用 `setTimeout(220)` 统一收尾，二选一，保证脉冲能播完。

### 3.3 `Detail.tsx` — 新增组件 `LockViewport`（同文件内）
Props：`{ item: MediaItem; closing: boolean; onRequestClose: () => void; onClosed: () => void }`

结构（从外到内）：
```
<div viewport>                      // absolute inset-0, overflow-hidden, 主题底色, onWheel/onPointerDown 捕获
  <div pulseWrapper>                // scale + opacity 进出脉冲（CSS transition）
    <div panZoom>                   // transform: translate(tx,ty) scale(s); transformOrigin 0 0
      <媒体>                        // 图片(缩略图兜底+原图) 或 video(loop autoplay muted, 无 controls)
    </div>
  </div>
  <button X>                        // 左上角，复刻原后退按钮样式，图标 X
  {item.type==='video' && <VideoScrubber …/>}  // 底部自定义进度条，鼠标距底阈值显隐
</div>
```

内部状态/逻辑：
- `const [t, setT] = useState({ tx: 0, ty: 0, s: 1 })`，初始 fit（媒体用 `object-contain` 充满 viewport，初始 `{0,0,1}` 即 fit，无需额外计算）。
- `viewportRef` 取 `getBoundingClientRect` 用于把 `clientX/Y` 换算成相对坐标 `cx,cy`。
- **wheel**：`onWheel`（需 `{ passive:false }` 才能 preventDefault——React onWheel 是 passive，**改用 `useEffect` + `addEventListener('wheel', …, {passive:false})` 绑到 viewportRef**），算 newScale + 锚点（见 2.3），`setT`。`e.preventDefault()` 防止穿透。
- **pan**：监听 viewport `pointerdown`：`button===1`（中键）或 `spaceHeldRef.current && button===0`（空格+左键）才启动；记录 `startX/Y` 与起始 `tx/ty`，`setPointerCapture`，`pointermove` 累加 `setT(tx0+dx, ty0+dy)`，`pointerup` 结束。启动时 setPanCursor(GRAB)，结束恢复（空格仍按住→OPEN，否则 null）。中键 pan 注意阻止默认（中键可能触发自动滚动）。
- **空格**：组件内 keydown/keyup 维护 `spaceHeldRef`，按下且未拖拽时 setPanCursor(OPEN)，松开且未拖拽时清除。`e.code==='Space'` 时 `e.preventDefault()`（避免页面滚动/按钮触发）。
- **F 复位**：keydown `e.key==='f'||'F'` → `setT({tx:0,ty:0,s:1})`。
- **Esc**：可在 DetailView 层统一处理（推荐），LockViewport 不重复绑 Esc，避免双重触发。
- **进出脉冲**：用 `mounted` state + `closing` prop 控制 pulseWrapper 的 inline style（`scale`/`opacity`）。`closing` 变 true 时切到退出态，`onTransitionEnd` 或 `setTimeout` 后调 `onClosed`。
- **清理**：unmount / 退出时务必移除所有全局监听 + 清除 pan cursor 注入的 `<style>`。

### 3.4 `Detail.tsx` — 新增组件 `VideoScrubber`（同文件内）
Props：拿到 `videoRef`（指向 LockViewport 渲染的那个 `<video>`）即可，或把 video element 通过 state/ref 上提。
- 维护 `currentTime` / `duration` / `playing`，由 video 事件（`timeupdate`/`loadedmetadata`/`play`/`pause`）驱动。
- 自动隐藏：父 LockViewport 把"鼠标距底"算出的 `barVisible` 传进来，或 VideoScrubber 自己监听 viewport pointermove。拖拽 seek 时 `barVisible` 强制 true。
- 轨道：点击/拖拽换算到 `currentTime`。样式见 1.5（glass + primary + 亮暗自适配）。
- 播放/暂停按钮切换 `video.play()/pause()`。

> video element 归属：建议 video 由 LockViewport 渲染并持有 ref，VideoScrubber 作为受控子组件接收 ref + 显隐标志。注意 LockViewport 的 video 与详情页原 `VideoPlayer` 是**两个不同实例**（详情页那个被 overlay 盖住，可让它继续播放或在锁定时无所谓——它在底层不可见）。锁定退出后回到原 VideoPlayer 实例，无需同步进度（可接受）。

---

## 4. 边界与注意事项

1. **不改 stores / IPC / 数据库**：本功能纯渲染层，无需动 `contract.ts` / `handlers.ts` / `preload`。
2. **不改 `assets/main.css`**（进出脉冲用 inline `scale`+`opacity`+transition 实现，无需新 keyframe）。若确实想用 keyframe 也可加，但优先内联。
3. **CanvasView 重构后回归**：抽 handCursor 后，画布的中键/空格 pan 手型必须照旧工作——改完肉眼确认（或至少 typecheck 过 + 代码 diff 自查 import 正确）。
4. **passive wheel 陷阱**：React 的 `onWheel` 默认 passive，`preventDefault` 无效。锁定 viewport 的滚轮缩放必须用原生 `addEventListener('wheel', handler, { passive: false })`。
5. **指针捕获**：pan 用 `setPointerCapture` 保证移出元素仍跟手。
6. **cursor 泄漏**：任何注入到 `document.head` 的 `<style>` 在退出/卸载时必须移除。
7. **空格冲突**：详情页非锁定态空格 = 下一张（现有逻辑）。锁定态空格 = pan，必须被 LockViewport 拦截且 `preventDefault`，且 DetailView 层在锁定态不响应空格切图。
8. **类型**：渲染层从 `../../../main/recommender` import `MediaItem`（已有）。

---

## 5. 完成标准 / 验证

代码完成后：
1. 运行 `npm run typecheck`（node + web 两份都要过）。
2. 运行 `npm run lint`。
3. **不要自行启动 dev server**，向用户输出下方测试清单，由用户人工验证。

### 测试清单（交付给用户）
- [ ] 图片详情页双击大图 → 进入锁定模式，有放大脉冲动效，其它 UI 全部消失、推荐面板收起、WCO 仍在。
- [ ] 视频详情页双击 → 同样进入锁定，**不触发**浏览器原生全屏。
- [ ] 锁定中滚轮缩放，缩放锚点跟随光标（光标下的点保持不动）。
- [ ] 中键拖拽可 pan，手型光标为 grab。
- [ ] 空格+左键拖拽可 pan，按住空格时光标为 open hand，拖拽时为 grab。
- [ ] F 键复位到初始 fit。
- [ ] Esc 退出锁定（**回到详情页而非主页**），有缩小脉冲动效；详情页状态（当前图、面板开关等）原样保留。
- [ ] 左上角按钮在锁定态显示为 X（同款样式），点击退出锁定。
- [ ] 锁定中视频继续循环播放，且支持 pan/zoom。
- [ ] 视频底部进度条：鼠标移近窗口底部时显现、移开后隐藏；拖拽 seek 时保持显示。
- [ ] 进度条样式在亮/暗主题下都正确（glass 背景 + primary 填充 + 可读文字）。
- [ ] 进度条播放/暂停、点击 seek、拖拽 seek、时间显示均正常。
- [ ] 退出锁定后，详情页滚轮恢复"切图"语义，无残留的手型光标。
- [ ] 画布模式（canvas）的中键/空格 pan 手型光标回归正常（重构 handCursor 后无回归）。
