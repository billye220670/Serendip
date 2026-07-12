---
kind: logging_system
name: 基于 console 的原生日志输出（无专用日志框架）
category: logging_system
scope:
    - '**'
source_files:
    - src/main/index.ts
    - src/main/watcher/index.ts
    - src/main/db/index.ts
    - src/main/thumbnailer/protocol.ts
    - src/preload/index.ts
    - src/renderer/src/App.tsx
---

本仓库未引入任何第三方日志框架，也未建立统一的 logger 模块或日志级别体系。主进程与渲染层全部使用 Node/Electron 内置的 `console.log` / `console.error` / `console.warn` 直接输出到标准输出/错误流。

**使用现状**
- 主进程：在启动流程、数据库迁移、文件监听器、缩略图协议等关键路径上以 `[Startup]`、`[Watcher]` 等前缀区分上下文，例如 `src/main/index.ts`、`src/main/watcher/index.ts`、`src/main/db/index.ts`、`src/main/thumbnailer/protocol.ts`。
- 渲染层：在 IPC 调用失败、媒体播放异常等场景下用 `console.error` / `console.warn` 记录错误，如 `src/renderer/src/App.tsx`、`src/renderer/src/components/MediaCard.tsx`、`src/renderer/src/stores/library.ts`。
- preload 脚本也直接使用 `console.error` 透传错误。

**约定与约束**
- 无结构化字段、无日志级别枚举、无统一格式化函数；每条日志都是自由文本，靠人工添加的前缀来区分来源。
- 不存在日志开关、采样、分级输出到不同 sink 的能力，所有日志均走默认控制台。
- 未发现对 `debug` 包的使用（仅作为依赖出现在 lockfile 中），也没有自定义 logger 封装。

**开发者应遵循的规则**
1. 如需新增日志，继续使用 `console.log` / `console.error` / `console.warn`，并沿用 `[模块名]` 前缀约定以便过滤。
2. 避免在高频路径（如 watcher flush 循环内）打印大量信息，以免污染控制台。
3. 暂不引入第三方日志库，保持与现有风格一致。