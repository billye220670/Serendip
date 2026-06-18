# 阶段 7：边界 / 空态 / 性能收尾

> 状态：🔲 待开发
> 所属计划：[main.md](main.md)

---

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
