---
kind: build_system
name: Electron + Vite + electron-builder 构建体系
category: build_system
scope:
    - '**'
source_files:
    - package.json
    - electron.vite.config.ts
    - electron-builder.yml
    - tsconfig.json
    - tsconfig.node.json
    - tsconfig.web.json
---

本项目采用 Electron + Vite + electron-builder 的现代化桌面应用构建方案，通过 npm scripts 串联开发、类型检查与打包流程。

## 构建工具链

- **Vite (electron-vite)**：作为核心构建器，同时处理主进程（Node.js）、预加载脚本和渲染进程（React）的编译与热更新。入口配置位于 `electron.vite.config.ts`，为渲染层启用 React 插件并配置 `@renderer` 路径别名。
- **TypeScript**：使用 Project References 将构建拆分为两个独立子项目——`tsconfig.node.json`（主进程 + preload）和 `tsconfig.web.json`（渲染进程），顶层 `tsconfig.json` 仅做引用聚合。
- **electron-builder**：负责跨平台打包分发，支持 Windows（NSIS 安装包）、macOS（dmg）、Linux（AppImage/snap/deb）。

## 关键脚本命令

- `npm run dev`：启动开发服务器（electron-vite dev）
- `npm run start`：预览已构建产物（electron-vite preview）
- `npm run build`：先执行双端 typecheck，再调用 electron-vite build 输出到 out/
- `npm run build:unpack`：构建后以目录形式输出（不压缩 asar），便于调试
- `npm run build:win / :mac / :linux`：针对目标平台打包，自动触发 electron-builder

## 打包产物与资源策略

- 构建输出目录：out/（由 electron-vite 默认约定）
- 应用入口：package.json 中 main 指向 ./out/main/index.js
- 资源过滤：electron-builder.yml 通过 files 白名单排除源码、配置文件及 IDE 相关目录，仅打包运行时所需文件
- 原生模块：sharp、better-sqlite3、ffprobe-installer 等依赖在打包时按需安装，npmRebuild: false 禁用二次重建以提升速度
- 资源解包：asarUnpack 保留 resources/** 不被压缩进 asar，供主进程直接访问

## 平台特定配置

- Windows：NSIS 安装包，自定义可执行名 Serendip，桌面快捷方式常驻
- macOS：声明相机、麦克风、文档/下载文件夹权限描述，未启用公证（notarize: false）
- Linux：同时生成 AppImage、snap、deb 三种格式
- 自动更新：预留 generic provider 发布地址（当前为占位符）

## 开发者规范

1. 新增源文件需同步纳入对应 tsconfig 的 include 范围
2. 需要暴露给渲染层的 API 应通过 src/preload 暴露，禁止在主进程直接挂载全局
3. 打包前必须通过 npm run typecheck，确保双端类型一致
4. 跨平台原生依赖变更需在各 CI 环境验证，避免 node-gyp 重建失败
5. 静态资源放入 resources/ 或 build/ 目录，并通过相对路径引用，不要硬编码绝对路径