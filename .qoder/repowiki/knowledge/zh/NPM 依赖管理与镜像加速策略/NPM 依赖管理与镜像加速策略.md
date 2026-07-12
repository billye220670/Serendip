---
kind: dependency_management
name: NPM 依赖管理与镜像加速策略
category: dependency_management
scope:
    - '**'
source_files:
    - package.json
    - .npmrc
    - package-lock.json
---

本项目采用标准的 npm 工作流管理依赖，通过 package.json 声明运行时与开发时依赖，配合 package-lock.json（lockfileVersion: 3）锁定精确版本，确保多环境构建一致性。

包源与镜像配置：.npmrc 集中配置了国内镜像加速，覆盖 npm 主源、Electron 二进制、electron-builder 打包产物、sharp 的 libvips 预编译包、better-sqlite3 等原生模块的 prebuild-install 下载，以及 Node.js disturl，显著降低国内网络环境下安装耗时与失败率。

依赖分层：
- dependencies：包含 Electron 运行时库（@electron-toolkit/*）、媒体处理（sharp、fluent-ffmpeg、ffmpeg-static、@ffprobe-installer/ffprobe）、数据库（better-sqlite3）、文件监听（chokidar）、UI 交互（@dnd-kit/*、react-moveable、react-selecto）、状态管理（zustand）等核心能力。
- devDependencies：涵盖构建工具链（electron-vite、vite、electron-builder）、类型系统（typescript、@types/*）、代码质量（eslint、prettier）、样式（tailwindcss、autoprefixer、postcss）及 React 生态插件。

版本策略：所有依赖使用 ^ 语义化版本范围，允许小版本更新；无 vendoring 或私有仓库，完全依赖 npm registry 及其镜像。未配置 .nvmrc 或 engines 字段约束 Node 版本，但各包自身通过 engines 声明最低要求。

开发者约定：新增依赖应区分 runtime/dev 归属，避免将构建期工具误入 dependencies；涉及原生模块（sharp、better-sqlite3、electron）需确认镜像已覆盖对应二进制下载路径。