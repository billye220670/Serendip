---
kind: error_handling
name: 错误处理：主进程业务层抛错 + IPC 透传，渲染层无统一捕获机制
category: error_handling
scope:
    - '**'
source_files:
    - src/main/ipc/handlers.ts
    - src/main/canvases/index.ts
    - src/main/categories/index.ts
    - src/main/index.ts
    - src/main/scanner/index.ts
---

## 1. 采用的方式与工具

- 主进程（Node/Electron）使用原生 `throw new Error('中文消息')` 抛出业务错误；对 SQLite 约束异常通过 `err.code === 'SQLITE_CONSTRAINT_UNIQUE'` 分支判断并转换为友好中文错误。
- IPC 层 `ipcMain.handle` 回调直接返回 Promise 或同步值，未做 try/catch 包裹；上层模块抛出的 Error 会原样回传到渲染层调用方。
- 渲染层（React/Zustand）未发现任何 try/catch、.catch() 或全局 window.onerror/unhandledrejection 监听，调用 IPC 的 store 方法均假设成功路径。
- 启动阶段兜底：`src/main/index.ts` 在应用启动时自动扫描根目录，用 try/catch 仅 console.error 记录失败，不中断进程。

## 2. 核心文件与位置

- `src/main/ipc/handlers.ts`：所有 ipcMain.handle 入口，未做统一错误包装
- `src/main/canvases/index.ts`：唯一名重复 → SQLITE_CONSTRAINT_UNIQUE → 抛 '画布名已存在'
- `src/main/categories/index.ts`：同上模式，抛 '分类名已存在' / '分类不存在'
- `src/main/index.ts`：启动期 scanRoot 失败仅 console.error，不向上抛
- `src/main/scanner/index.ts`：stat 失败按 catch { return null } 静默跳过，不抛错

## 3. 架构与约定

- 错误来源分层清晰：参数校验（空名、超长）→ 立即抛 Error；数据库约束冲突 → catch 后重抛中文 Error；IO 失败（stat）→ 静默忽略。
- 错误传播链：canvases/index.ts → ipcMain.handle(IPC.CREATE_CANVAS, ...) → 渲染层 createCanvas store 方法 → 组件。中间没有统一的 error wrapper，也没有将错误码结构化返回。
- 平台差异容错：handlers.ts 中对 setTitleBarOverlay 调用用 try/catch 包裹以兼容 macOS，属于「可忽略的平台能力缺失」场景。
- 无全局错误边界：渲染层未见 React Error Boundary、Zustand middleware 的错误拦截、或 Electron webContents.on('uncaught-exception') 等全局策略。

## 4. 开发者应遵循的规则

1. 主进程业务函数：对非法输入直接 throw new Error('中文消息')；对 SQLite 约束错误先 catch 再根据 code 重抛友好消息，不要向上传递原始 SQL 错误对象。
2. IPC handler 层：如需对外暴露错误码/类型，应在 handlers.ts 中统一 try/catch 包装，把 Error 转为 { ok: false, code, message } 结构体返回，避免把内部堆栈泄露到渲染层。
3. 渲染层调用方：当前代码假设 IPC 调用永不失败，后续新增调用处应显式 try/catch 或封装一个带错误处理的 IPC 客户端，否则 UI 会在主进程抛错时崩溃。
4. 可忽略错误：如平台 API 不支持（WCO）、文件 stat 失败等，采用 try/catch 静默降级，不要中断业务流程。
5. 日志规范：启动期或后台任务失败统一走 console.error('[标签] 原因:', err)，便于调试定位。