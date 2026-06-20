# 阶段 6：摄影机手摇（噪声 + 脉冲）通用引擎 + 调试面板

> 状态：🔲 待开发
> 所属计划：[main.md](main.md)

---

## 0. 这是什么 / 为什么

把静态拼贴 / 单图查看变成「手持摄影机」的呼吸感 —— 镜头持续轻微游移，并隔一会儿来一下抖动。老版本 app 用户（尤其 NSFW 囤图党）反馈这个「活起来」的效果非常实用，本期把它做成**通用、解耦**的相机运动层。

**两个硬性目标**：

1. **运动 = 两部分 compose（叠加）**：
   - **噪声运动（noise）**：机位持续的平滑游移（位移 / 旋转 / 缩放各一路噪声），永不停歇。
   - **脉冲抖动（pulse）**：每隔一段时间「咯噔」抖一下，振幅可调、间隔可调、间隔在 base 上随机 ± 一个增益。
   - 最终偏移 = `噪声偏移 + 脉冲偏移`，再乘总强度。

2. **彻底解耦、两处通用**：同一套引擎 / 参数 / hook，既能用在**画布页面**，也能用在**大图详情页的锁定模式**（`LockViewport`）。两处共享同一份参数与同一份算法实现 —— 不允许各写一份。

---

## 1. 核心设计：相机运动是一个「独立 transform 层」

**关键洞察**：不去碰任何已有的坐标系（画布的 viewport 世界坐标 / 锁定模式的 pan-zoom），而是在内容外面再套一层**只由手摇引擎写 `transform` 的 wrapper**。这一层的 transform 完全归引擎所有，consumer 只负责提供这个 DOM 节点。

```
画布：   container
           └─ <div.camera-shake-layer>   ← 引擎写 transform，transform-origin: center
                └─ {items.map(CanvasItemNode)}   ← 整组画布元素
           （Moveable / Selecto / 裁剪框 / 工具栏在 shake 层之外，不抖）

锁定：   viewport (absolute inset-0)
           └─ pulseWrapper (进出脉冲 scale+opacity)
                └─ <div.camera-shake-layer>   ← 引擎写 transform，transform-origin: center
                     └─ panZoom 层 (translate+scale)
                          └─ 媒体
           （X 按钮 / 视频进度条在 shake 层之外，不抖）
```

**为什么这样最干净**：
- shake 层 transform 是**纯手摇**，无需和 viewport / pan-zoom 做矩阵合成 —— 两套坐标语义完全不混。
- 引擎每帧直接写 `element.style.transform`（不走 React state），不触发任何组件重渲染 → 60fps 不掉帧、CPU 友好。
- 停用时把该层 transform 清成 `''` 即瞬间恢复。viewport store / canvasItems store / pan-zoom state 全程不动。
- 位移振幅是**屏幕像素**（shake 层在屏幕空间），手持感与当前缩放无关 —— 符合直觉。

> 这取代了旧文档「叠加到 viewport 输出矩阵 / 不进 viewport store」的方案：用独立 transform 层更简单、更解耦，且天然适配两个不同坐标模型。

---

## 2. 运动模型（noise + pulse compose）

每帧给定参数 `params` 与时间 `t`（秒），引擎产出一个偏移：

```ts
interface ShakeOffset {
  dx: number      // 屏幕像素
  dy: number      // 屏幕像素
  dRot: number    // 弧度
  dScale: number  // 乘子（1 = 不缩放）
}
```

最终写到 DOM：`transform: translate(dx px, dy px) rotate(dRot rad) scale(dScale)`，`transform-origin: center`。

### 2.1 噪声运动（持续）

用 1D 值噪声 `noise(stream, x) ∈ [-1, 1]`，平滑、可种子化。4 路独立 stream（靠 seed offset 区分）：

```
nx   = noise(seed+0, t * noisePosFreq)
ny   = noise(seed+1, t * noisePosFreq)
nrot = noise(seed+2, t * noiseRotFreq)
nzm  = noise(seed+3, t * noiseZoomFreq)

noise.dx     = nx   * noisePosAmp
noise.dy     = ny   * noisePosAmp
noise.dRot   = nrot * noiseRotAmp(转弧度)
noise.dScale = 1 + nzm * noiseZoomAmp
```

> x/y 用同一 freq 但不同 stream → 平滑的二维李萨如式游移，不会沿对角线死板往返。

### 2.2 脉冲抖动（间歇）

引擎维护一个调度器 + 一组「活跃脉冲」：

- **调度**：记 `nextPulseAt`。当 `t ≥ nextPulseAt` 触发一次脉冲，并重排下一次：
  ```
  nextPulseAt = t + max(0.05, pulseInterval + rand(-pulseIntervalJitter, +pulseIntervalJitter))
  ```
  即每次脉冲完，间隔 = `base ± 随机增益`（满足「间隔随机加减增益可调」）。
- **单次脉冲**：触发时随机一个方向角 `θ`、旋转符号、缩放符号，记 `startT`。其包络（衰减振荡，给「咯噔一下又回弹settle」的手感）：
  ```
  τ   = t - startT                       (τ ≥ 0)
  env = exp(-τ / pulseDecay) * cos(2π * pulseWobble * τ)
  ```
  - `pulseWobble = 0` → 纯指数衰减（一推就回，不回弹）。
  - `pulseWobble > 0` → 推出去后来回弹几下再静止（像被撞了一下的镜头）。
- **叠加多个活跃脉冲**（若 interval < decay 会重叠，手感更自然）：对每个活跃脉冲求和，包络衰减到 < 0.001 即剔除。
  ```
  pulse.dx     = Σ cos(θ) * pulsePosAmp * env
  pulse.dy     = Σ sin(θ) * pulsePosAmp * env
  pulse.dRot   = Σ rotSign * pulseRotAmp(转弧度) * env
  pulse.dScale = 1 + Σ zoomSign * pulseZoomAmp * env
  ```

### 2.3 compose + 总强度 + 淡入

```
dx     = (noise.dx + pulse.dx) * masterIntensity * ramp
dy     = (noise.dy + pulse.dy) * masterIntensity * ramp
dRot   = (noise.dRot + pulse.dRot) * masterIntensity * ramp
dScale = 1 + ((noise.dScale-1) + (pulse.dScale-1)) * masterIntensity * ramp
```

- `ramp`：启用瞬间 0→1 缓动（≈0.4s ease），避免「啪」地跳起来。停用直接停（清 transform）。
- `masterIntensity = 0` → 完全静止；`= 2` → 各参数效果翻倍。

---

## 3. 参数表（调试面板暴露；范围特意给大，便于试）

| 参数 | 范围 | 步进 | 说明 |
|---|---|---|---|
| `masterIntensity` | 0 – 2 | 0.05 | 总强度乘子 |
| **噪声** `noisePosAmp` | 0 – 200 px | 1 | 位移振幅（调试给大，正常用可能 5–30） |
| `noisePosFreq` | 0.02 – 4 Hz | 0.01 | 位移噪声频率 |
| `noiseRotAmp` | 0 – 15 ° | 0.1 | 旋转振幅 |
| `noiseRotFreq` | 0.02 – 3 Hz | 0.01 | 旋转噪声频率 |
| `noiseZoomAmp` | 0 – 0.3 | 0.005 | 缩放振幅（相对 1.0 的 ± 比例） |
| `noiseZoomFreq` | 0.02 – 2 Hz | 0.01 | 缩放噪声频率 |
| `noiseSeed` | 整数 | — | 决定噪声相位；面板带「🎲 随机种子」按钮 |
| **脉冲** `pulsePosAmp` | 0 – 300 px | 1 | 脉冲位移峰值 |
| `pulseRotAmp` | 0 – 20 ° | 0.1 | 脉冲旋转峰值 |
| `pulseZoomAmp` | 0 – 0.4 | 0.005 | 脉冲缩放峰值 |
| `pulseInterval` | 0.2 – 12 s | 0.1 | 脉冲基础间隔 |
| `pulseIntervalJitter` | 0 – 6 s | 0.1 | 间隔随机 ± 增益 |
| `pulseDecay` | 0.05 – 2 s | 0.01 | 单次脉冲衰减时间常数 |
| `pulseWobble` | 0 – 25 Hz | 0.5 | 脉冲内回弹频率（0=纯衰减） |

`DEFAULT_SHAKE_PARAMS`：给一组温和的手持默认值（如 `noisePosAmp 12 / noisePosFreq 0.5 / noiseRotAmp 0.6 / noiseZoomAmp 0.01 / pulsePosAmp 40 / pulseInterval 4 / pulseIntervalJitter 2 / pulseDecay 0.4 / pulseWobble 6 / masterIntensity 1`）。`enabled` 默认 false。

---

## 4. 文件结构（引擎纯函数 / 状态 / hook / 面板 四层）

**新建**：

- `src/renderer/src/lib/valueNoise.ts`
  1D 值噪声：`makeNoise(seed)` → `(stream:number, x:number)=>number ∈[-1,1]`，平滑插值（smoothstep）。~30 行，无依赖。

- `src/renderer/src/lib/cameraShake.ts`（**纯引擎，零 React / 零 DOM，可单测**）
  - `ShakeParams` / `ShakeOffset` 接口 + `DEFAULT_SHAKE_PARAMS`。
  - `createShakeRunner()` → `{ sample(params, tSeconds): ShakeOffset, pulseNow(), reset() }`。
    内部持有脉冲调度状态（`nextPulseAt` / 活跃脉冲数组）与 ramp 起始时间；`sample` 推进调度并 compose noise+pulse。`pulseNow()` 立刻塞一个脉冲（面板「测试脉冲」用）。
  - `shakeTransform(offset): string` → `translate(...)rotate(...)scale(...)` 字符串。

- `src/renderer/src/stores/cameraShake.ts`（**共享状态，两处同一份**）
  ```ts
  interface CameraShakeState {
    enabled: boolean              // 全局开关（持久化）
    paused: boolean              // 临时暂停（不持久化，面板/编辑用）
    params: ShakeParams          // 当前参数（持久化）
    presets: Record<string, ShakeParams>  // 自定义预设（持久化 localStorage）
    setParam(key, value): void
    setParams(p): void
    setEnabled(b): void
    setPaused(b): void
    randomizeSeed(): void
    savePreset(name): void
    loadPreset(name): void
    deletePreset(name): void
  }
  ```
  用 `persist`（key `serendip-camera-shake`，仅持久化 `enabled` / `params` / `presets`，**不**持久化 `paused`）。`active` 派生 = `enabled && !paused`。

- `src/renderer/src/hooks/useCameraShake.ts`（**通用 hook，两处都用它**）
  ```ts
  useCameraShake(targetRef: RefObject<HTMLElement|null>, opts: { active: boolean }): void
  ```
  - 读 store 的 `enabled` / `paused` / `params`；`run = active && enabled && !paused`。
  - `run` 为真：起 RAF，每帧 `runner.sample(params, now)` → 写 `targetRef.current.style.transform = shakeTransform(offset)`。
  - `run` 转假 / 卸载：`cancelAnimationFrame` + 清 `transform=''` + `runner.reset()`。
  - 每个 consumer 各持有自己的 `runner` 实例 → 两处脉冲时序互不同步（各自独立呼吸，更自然）；但**参数与算法完全同源**。
  - 用 `useRef` 存最新 params，RAF 闭包读 ref，避免参数变动重启 RAF。

- `src/renderer/src/views/canvas/CameraShakePanel.tsx`
  浮动调试面板（参考 `App.tsx` 的 `SettingsPopover`：`createPortal` 到 body + 点外关闭 + Esc 关闭 + glass 样式）。内容：
  - 顶部：开关（启用/停用）、「暂停」临时按钮（按下 paused=true 可编辑画布，松开恢复）、「🎲 随机种子」、「⚡测试脉冲」（调 `runner.pulseNow()` —— 见下方接线）。
  - 两组滑杆（噪声 / 脉冲），每条：label + `<input type=range>` + 数值。glass + `bg-primary` 填充，亮暗自适配。
  - 底部：复制 JSON / 预设下拉（加载）/ 另存为预设（PromptDialog 输入名）/ 删除预设。

**改动**：

- `src/renderer/src/views/canvas/CanvasToolbar.tsx`
  - 相机图标按钮改为**状态按钮**：点击直接 toggle 手摇总开关（`enabled`），高亮跟随 `enabled`。
  - 开启后按钮右侧展开 `<CameraShakeControls>`：预设 chip（滚轮循环切换预设，原生非 passive 监听 + `stopPropagation` 阻断穿透到画布缩放；点击向上弹出实色预设列表，列表项 hover 右侧 ✕ 删除）+ 设置齿轮（点击向上浮出参数面板）。

- `src/renderer/src/views/canvas/CameraShakeControls.tsx`（新建）
  - 预设 chip + 列表 + 齿轮；列表/面板均实色（`bg-sidebar`，非毛玻璃）。

- `src/renderer/src/views/canvas/CameraShakePanel.tsx`（参数面板，重写）
  - 实色面板，锚在齿轮上方。**不含**启用/暂停/测试脉冲/种子/复制 JSON/预设下拉/保存/删除。
  - 顶部：预设名输入框（hint「输入预设名称」）+ 右侧 ＋ 按钮（主题高亮背景、白色前景），回车或点 ＋ 创建预设。
  - 两个 tab「摇摆（噪声）」「脉冲」，每个 tab 标签前带一个开关组件（点击快速开关该组，互不影响）；点击 tab 切换中间显示的该组参数。
  - 底部分割线 + 总强度滑块（不受分组开关影响）。

- `src/renderer/src/stores/cameraShake.ts`
  - `ShakeParams` 增 `noiseEnabled` / `pulseEnabled`（随预设一起存）。
  - 增 `presetOrder`（滚轮循环顺序）+ `activePreset`；`createPreset`（重名/空名返回错误）/ `applyPreset` / `deletePreset` / `cyclePreset`。改任意参数即脱离 `activePreset`（标为自定义）。
  - 移除 `paused` / 测试脉冲相关。**编辑锁定 = `enabled`**（关掉摄影机即恢复编辑，不再有「暂停」）。

- `src/renderer/src/views/canvas/CanvasView.tsx`
  - 套 `.camera-shake-layer` + 挂 hook；`shakeEditLocked = enabled` 时清选区 + 吞掉选择/拖拽/框选手势。

- `src/renderer/src/views/Detail.tsx`（`LockViewport`）
  - 插 `.camera-shake-layer` + 挂同一 hook（只消费参数）。

---

## 5. 用户体验增强（已纳入设计）

1. **🎲 随机种子**：一键换噪声相位，每次手感不同。
2. **⚡测试脉冲**：不必等 interval，点一下立刻感受脉冲振幅 / 衰减 / 回弹。
3. **启用淡入 ramp**：开启不「啪」地跳。
4. **暂停（而非停用）**：编辑画布时临时静止，松开恢复，不丢参数。
5. **锁定模式自动继承**：在画布调好的「呼吸」参数，进大图沉浸查看时自动生效（单图呼吸正是这功能最爽的场景）。
6. **复制 JSON + 预设**：方便反馈给开发 / 自存常用档（v1.5 收成内置预设）。

---

## 6. 明确不做（防 scope 蔓延）

- 内置预设（v1.5 用户调好后回收）。
- 锁定模式里再开一套调试面板（锁定只消费参数）。
- 每元素独立手摇 / 视差分层（v2）。
- 与 prefers-reduced-motion 联动（本项目无障碍非目标）。

---

## 7. 测试清单（交付用户人工验证）

1. 画布工具栏点相机图标 → 调试面板浮出（glass、点外/Esc 关闭）。
2. 启用 + 调 `noisePosAmp=60 / noisePosFreq=1` → 画面持续平滑游移；停用 → 瞬间静止复位。
3. `noiseRotAmp` / `noiseZoomAmp` 拉大 → 看到轻微旋转 / 缩放呼吸。
4. 脉冲：`pulseInterval=2 / pulseIntervalJitter=1.5 / pulsePosAmp=120` → 每隔约 0.5–3.5s「咯噔」抖一下，间隔明显不固定。
5. `pulseWobble=12` → 脉冲后能看到回弹 settle；`pulseWobble=0` → 一推即回不回弹。
6. ⚡测试脉冲 → 立刻抖一下（不等 interval）。
7. `masterIntensity=0` → 完全静止；`=2` → 幅度翻倍。
8. 启用时画布编辑锁定（拖动元素不响应、选区清空）；面板「暂停」→ 可编辑、画面静止；松开「暂停」→ 恢复抖动。
9. 🎲 随机种子 → 游移形态改变。
10. 复制 JSON → 剪贴板形如 `{"masterIntensity":1,"noisePosAmp":60,...}`。
11. 另存预设「轻微手持」→ 刷新 app 预设仍在 → 加载恢复参数。
12. **锁定模式继承**：画布启用手摇后，进大图详情双击进锁定模式 → 单图自动呼吸（pan/zoom 仍正常，X 按钮/进度条不抖）；退出锁定回详情正常。
13. 切到探索/其他视图 → 画布 RAF 取消、无残留抖动；切回画布按 `enabled` 恢复。
14. CPU：持续 60fps 抖动单核占用合理（< 10%），无明显掉帧。
15. `npm run typecheck`（node + web 两份）+ `npm run lint` 通过。
