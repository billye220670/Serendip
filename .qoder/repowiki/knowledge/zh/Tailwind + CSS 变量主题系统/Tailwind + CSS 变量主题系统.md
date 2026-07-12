---
kind: frontend_style
name: Tailwind + CSS 变量主题系统
category: frontend_style
scope:
    - '**'
source_files:
    - tailwind.config.js
    - src/renderer/src/assets/main.css
    - src/renderer/src/stores/ui.ts
    - postcss.config.js
---

本项目采用 **Tailwind CSS 3** 作为原子化样式框架，配合 **PostCSS + Autoprefixer** 构建，通过 **CSS 自定义属性（CSS Variables）** 实现亮/暗双主题切换，整体风格遵循现代桌面应用 UI 规范。

## 1. 技术栈与工具链
- **Tailwind CSS 3.4**：所有组件类名基于 Tailwind 原子类组合，`tailwind.config.js` 中仅做最小扩展。
- **PostCSS + Autoprefixer**：在 `postcss.config.js` 中启用，负责前缀兼容。
- **CSS 自定义属性**：主题色、背景、边框等全部通过 `--color-*` 变量驱动，避免硬编码颜色值。
- **无第三方 UI 组件库**：未引入 shadcn/ui、Ant Design 等，所有交互控件均为自研 React 组件。

## 2. 主题架构
主题变量集中在 `src/renderer/src/assets/main.css`，通过 `:root[data-theme='light'|'dark']` 选择器分组定义：
- 品牌主色由 `--brand-hue`（默认 330）和 `--brand-sat`（81%）两个根变量派生，修改此处即可全局换色。
- 语义化变量包括 `--color-background / foreground / primary / border / muted / sidebar / glass / canvas` 等，映射到 Tailwind 的 `background / foreground / primary / border / muted / sidebar / glass / canvas` 颜色别名。
- 亮/暗两套变量分别针对滚动条轨道、缩略图阴影、毛玻璃透明度做了差异化处理。

主题切换由 Zustand store `stores/ui.ts` 管理，使用 `persist` 中间件将 `theme` 写入 `localStorage('serendip-ui')`，并在 `onRehydrateStorage` 回调中第一时间把 `data-theme` 写回 `documentElement`，确保首屏即渲染正确主题。

## 3. 设计约定与约束
- **颜色使用**：组件内一律使用 Tailwind 语义类（如 `bg-primary text-muted-foreground`），禁止直接写十六进制颜色；需要透明度的场景使用 `hsl(var(--brand-hue) ... / <alpha-value>)` 或 `bg-primary/10` 这类 Tailwind opacity modifier。
- **字体**：全局 `font-family` 指定为 Inter + 苹方 + 微软雅黑，禁用用户选中文本（`user-select: none`），符合桌面应用交互习惯。
- **动画**：关键帧动画集中在 `main.css`（`slide-from-bottom / slide-from-top / card-enter / canvas-fadein / review-label-punch`），组件侧通过 className 触发。
- **第三方库样式覆盖**：对 react-moveable 和 react-selecto 注入的运行时样式，统一通过 `!important` 覆盖控制框颜色与选区填充，使其跟随主题变量。
- **clsx 组合类名**：组件广泛使用 `clsx(...)` 动态拼接 Tailwind 类，保持条件样式可读性。

## 4. 关键文件
- `tailwind.config.js` — Tailwind 内容扫描路径与颜色别名映射
- `src/renderer/src/assets/main.css` — 主题变量、全局基础样式、动画与第三方库覆盖
- `src/renderer/src/stores/ui.ts` — 主题状态持久化与 DOM 同步
- `postcss.config.js` — PostCSS 插件配置