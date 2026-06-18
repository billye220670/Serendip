# 阶段 6：摄影机手摇调试面板

> 状态：🔲 待开发
> 所属计划：[main.md](main.md)

---

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
