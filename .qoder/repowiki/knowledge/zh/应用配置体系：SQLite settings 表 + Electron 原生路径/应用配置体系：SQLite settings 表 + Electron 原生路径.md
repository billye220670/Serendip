---
kind: configuration_system
name: 应用配置体系：SQLite settings 表 + Electron 原生路径
category: configuration_system
scope:
    - '**'
source_files:
    - src/main/db/index.ts
    - src/main/index.ts
    - electron-builder.yml
    - electron.vite.config.ts
    - package.json
---

本仓库没有独立的配置文件（如 .env、config.yaml、application.properties）或集中式配置加载模块。运行时配置通过以下两条路径承载：

1. **用户级持久化设置**：全部存储在 SQLite 数据库的 `settings` 表中（key/value 字符串），由主进程在启动时读取并驱动扫描/监听流程。
2. **构建与打包配置**：集中在根目录的 `electron-builder.yml`、`electron.vite.config.ts`、`package.json` 等文件中，用于定义产物结构、平台权限、开发代理等。

### 1. 用户运行时配置（settings 表）
- 位置：`src/main/db/index.ts` 中迁移脚本创建 `settings` 表（`key TEXT PRIMARY KEY, value TEXT NOT NULL`）。
- 典型键：`rootPath`（媒体根目录），主进程启动时通过 `SELECT value FROM settings WHERE key = 'rootPath'` 读取，若存在则自动执行增量扫描并启动文件监听器。
- 特点：
  - 所有设置均为字符串值，无类型校验层；新增键需自行维护迁移与读写逻辑。
  - 数据库位于 `app.getPath('userData')` 下的 `serendip.db`，启用 WAL 模式提升并发性能。
  - 未提供统一的 config getter/setter 封装，各模块直接通过 SQL 访问。

### 2. 构建期配置
- `electron-builder.yml`：定义应用 ID、产品名、asar 打包策略、NSIS/DMG/AppImage 输出、macOS 权限声明、通用更新源等。
- `electron.vite.config.ts`：Vite 多入口配置，仅包含 renderer 别名与 React 插件，main/preload 使用默认配置。
- `package.json`：scripts 暴露 dev/build/win/mac/linux 命令，依赖版本锁定于 lockfile。
- `.gitignore` / `electron-builder.yml` 显式排除 `.env*`、`.npmrc`、`pnpm-lock.yaml` 等敏感/本地文件进入发布包。

### 3. 环境变量约定
- 仅在开发阶段使用 `ELECTRON_RENDERER_URL`（由 electron-vite 注入），用于热重载渲染进程 URL。
- 生产环境不加载 dotenv，也没有任何 `process.env.*` 的配置开关。

### 4. 设计决策与约束
- **零外部配置依赖**：未引入 dotenv、js-yaml、conf 等库，避免将用户偏好外置为可编辑文本文件。
- **配置即数据**：把“应用设置”视为领域数据的一部分，走与 media_files、categories 相同的 DB 迁移管线，保证跨版本升级一致性。
- **安全边界**：敏感信息（如 API Key）不应以明文存入 settings 表；当前仓库也未实现密钥管理，如需扩展应引入系统钥匙串或加密存储层。

### 开发者应遵循的规则
- 新增应用设置时，先在迁移脚本中确保 `settings` 表结构兼容，再在主进程启动流程中补充读取/初始化逻辑。
- 不要在生产代码中硬编码路径或行为开关，统一通过 `settings` 表或 `app.getPath()` 获取。
- 构建期参数修改集中在 `electron-builder.yml` 与 `electron.vite.config.ts`，不要在业务代码里拼接版本号或平台判断。