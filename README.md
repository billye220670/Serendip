# Serendip

智能随机本地相册应用 — 用智能算法和无限瀑布流重新发现你的照片。

## 技术栈

- **应用框架**: Electron + electron-vite
- **UI**: React 19 + TypeScript + Tailwind CSS 3
- **状态管理**: Zustand (持久化)
- **瀑布流虚拟化**: masonic
- **拖拽**: @dnd-kit
- **图标**: lucide-react
- **数据库**: better-sqlite3
- **缩略图**: sharp (图片) + fluent-ffmpeg (视频)
- **文件监听**: chokidar

## 开发

```bash
# 安装依赖（已配置国内镜像）
npm install

# 启动开发服务器
npm run dev

# 类型检查
npm run typecheck

# 代码格式化
npm run format

# 构建 Windows 安装包
npm run build:win
```

## 项目结构

```
src/
├── main/           # Electron 主进程
│   └── index.ts    # 应用入口
├── preload/        # Electron 桥
│   └── index.ts
└── renderer/       # React 渲染层
    ├── src/
    │   ├── App.tsx
    │   ├── stores/       # Zustand 状态管理
    │   │   └── ui.ts
    │   └── assets/
    │       └── main.css  # Tailwind + 主题变量
    └── index.html
```

## 开发阶段

- [x] **阶段 0**: 脚手架 + Tailwind + 主题系统 + 布局骨架
- [x] **阶段 1**: SQLite schema + 递归扫描 + IPC 桥 + 扫描进度 UI
- [x] **阶段 2**: 智能随机算法 v1 + 探索瀑布流（虚拟化 + 视频 hover 播放 + 按需缩略图）
- [x] **阶段 3**: 喜欢/不感兴趣 + 右键菜单 + 失效兜底
- [x] **阶段 4**: 收藏分类（CRUD + 拖拽 + 二次确认）
- [ ] **阶段 5**: 多选模式（长按触发 + 批量操作）
- [ ] **阶段 6**: 评审滑卡模式
- [ ] **阶段 7**: 实时监听 + 启动增量同步 + 手动刷新
- [ ] **阶段 8**: 动效打磨 + 空/加载/错误态
- [ ] **阶段 9**: 大数据量压测与调优
