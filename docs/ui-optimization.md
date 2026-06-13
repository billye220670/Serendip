# UI 优化方案

## 1. 左侧边栏折叠功能

### 需求
- 左侧分类边栏可以折叠/展开
- 折叠按钮使用 lucide 图标（建议 `ChevronLeft` / `ChevronRight`），放在左侧面板右上角（serendip 文字右侧）
- 折叠/展开有平滑动画（200-300ms）
- 折叠后边栏只显示 icon（约 60-80px 宽度），类似常见应用的导航栏

### 展开状态
- 完整显示分类列表和文件/文件夹统计
- 底部显示白天/黑夜切换
- 折叠按钮显示 `ChevronLeft` 或类似左指向图标

### 折叠状态
- 左侧边栏宽度收窄至 icon-only 模式（约 70px）
- 每个分类/tab 仅显示其 icon 或缩写
- 折叠按钮显示 `ChevronRight` 或类似右指向图标
- **Hover Tooltip**：悬停在 icon 上时，在右侧浮出自定义主题 tooltip
  - Tooltip 样式：使用现有玻璃态 `bg-glass backdrop-blur-xl`
  - 位置：icon 右侧浮出，与 icon 顶部对齐
  - 内容：分类名称（或对应 tab 名）
  - 消失延迟：100ms 后出现，移开后立即消失

### 实现要点
- 使用 Zustand UI store 添加 `sidebarCollapsed` 状态 + `toggleSidebar()` 方法
- 侧栏容器 CSS transition：`width 250ms ease-in-out`
- Icon 到 Tooltip 的触发：使用浮动 UI 库（已有 `@floating-ui/react`）或原生 `onMouseEnter/Leave`
- 保存到 localStorage（或在 UI store 的 persist 中）

---

## 2. 白天/黑夜切换位置调整 & 信息显示简化

### 需求
- 白天/黑夜切换按钮从右下角移至**左下角**（左侧边栏最下方）
- 删除顶部的统计信息显示（xxx 个文件、xxx 个文件夹、xxx 个喜欢）
- 仅"喜欢"tab 在边栏**展开状态**下，其右侧显示收藏数量（右对齐，同普通分类的计数样式）

### 具体实现
- 在 `CategoryList.tsx` 底部添加主题切换按钮区域
- 喜欢 tab 的计数：从 `likedCount` state 获取，条件渲染 `{sidebarCollapsed ? null : <span className="ml-auto">{likedCount}</span>}`
- 移除 `Sidebar.tsx` 中的统计信息行

---

## 3. 顶部根目录更换按钮优化

### 需求
- 移除按钮的背景、描边、填充
- 文本内容替换为文件夹图标（lucide `Folder` 或 `FolderOpen`）
- 保持悬停时的交互反馈（可用 hover:opacity-60 等微妙效果）

### 实现
```jsx
// 当前可能的样子
<button className="px-3 py-2 rounded border bg-primary text-primary-foreground">
  更换根目录
</button>

// 优化后
<button className="p-2 hover:opacity-60 transition-opacity" title="更换根目录">
  <Folder className="w-5 h-5" />
</button>
```

---

## 4. 多选状态下未选中项暗化

### 需求
- 当进入多选模式（selection mode active）后，**未被选中的项目应该暗化**
- 已选中的项目保持正常亮度
- 过渡效果应平滑（200-300ms）

### 实现方案
- `MediaCard.tsx` 根据 `selected` state 条件应用暗化 class
- 未选中时添加 `opacity-50` 或 `saturate-50` 等
- 使用 CSS transition：`transition-[opacity,filter] duration-200`

```jsx
// 伪代码
<div className={cn(
  "transition-[opacity,filter] duration-200",
  active && !selected && "opacity-50 saturate-75"
)}>
  {/* card content */}
</div>
```

---

## 5. 暗色模式细线优化

### 需求
- 暗色模式下所有细线、分割线应**更深、更不明显**
- 避免浅灰色在暗色背景上显得突兀

### 当前状态
- 通常用 `border-gray-200`（浅）或 `border-gray-300`
- 暗色模式下通过 `dark:border-gray-700` 等 Tailwind 前缀

### 优化方案
- 检查现有 border 定义，暗色模式应调整至 `dark:border-gray-800` 或 `dark:border-slate-800`
- 细分割线（如 divider）用 `bg-gray-200 dark:bg-gray-900`
- 在 `assets/main.css` 中定义更暗的 CSS 变量：
  ```css
  :root[data-theme="dark"] {
    --border-subtle: #1f2937;  /* 更深的灰 */
  }
  ```
- 调整所有 border/divider 类，让暗色更和谐

---

## 6. 网格大小切换按钮优化

### 需求
- 大/中/小按钮（grid size toggle）移除背景、描边、填充
- 仅显示图标或文本，保持简洁
- 活跃状态用 opacity 或颜色变化表示

### 实现
```jsx
// 当前可能的样子
<button className="px-2 py-1 border rounded bg-primary">小</button>

// 优化后
<button className="p-1 transition-opacity hover:opacity-60 data-[active=true]:opacity-100">
  <span>小</span>
</button>
```

或用 icon 代替文字：
```jsx
<button className="p-1">
  <Rows1 className="w-4 h-4" />
</button>
```

---

## 实现顺序建议

1. **折叠功能**（1）— 核心交互，影响整体布局
2. **左侧栏信息调整**（2）— 依赖折叠状态的条件渲染
3. **按钮美化**（3、6）— 独立的样式优化
4. **多选暗化**（4）— 独立的状态样式
5. **暗色模式细线**（5）— CSS 全局调整

---

## 涉及文件

- `src/renderer/src/components/Sidebar.tsx` — 折叠状态管理、主题按钮位置
- `src/renderer/src/components/CategoryList.tsx` — 喜欢 tab 计数显示
- `src/renderer/src/components/MediaCard.tsx` — 多选暗化效果
- `src/renderer/src/App.tsx` — 根目录按钮、grid size 按钮
- `src/renderer/src/stores/ui.ts` — 添加 `sidebarCollapsed` state
- `src/renderer/src/assets/main.css` — 暗色模式变量调整
- `tailwind.config.js` — 按需补充色值

