---
kind: design
name: P2V Bridge 插件采用 Zustand persist + 主进程 IPC 推送路径版图片
source: session
category: adr
---

# P2V Bridge 插件采用 Zustand persist + 主进程 IPC 推送路径版图片

_来源：a76d8a1 → abbdd6c 提交周期内记录的编码计划——内容为规划时意图，实现可能滞后或有出入。_

**状态：** accepted

## 背景
需要为 Serendip 增加与 pix2real 的集成，将本地媒体文件推送到正在运行的 pix2real 工作流中。pix2real 提供新的路径版 external-image-push 接口（POST JSON 含绝对路径），无需鉴权。需要在 Electron 应用中实现一个可开关的 P2V Bridge 插件，支持右键菜单和多选浮条两种触发方式。

## 决策驱动
- 最小改动原则（复用现有 ui.ts 持久化模式）
- 避免渲染层 CORS 限制
- pix2real 未运行时菜单仍需正常显示
- 同机本地路径可直接读取

## 备选方案
- **Zustand persist 存 localStorage** — 优点：完全对齐现有 ui.ts 模式，零额外依赖，无需跨进程调用；缺点：数据仅本地存储，无跨设备同步
- **SQLite settings 表 + 新增 get/set IPC** _（已否决）_ — 优点：结构化存储，可扩展性强；缺点：需新增数据库表和 IPC 通道，改动大且收益为零
- **主进程后台轮询 + 产物下载（旧异步任务 API）** _（已否决）_ — 优点：功能完整，可获取处理结果；缺点：最新需求只需图片出现在界面，不需要轮询/下载/鉴权逻辑
- **运行时 GET /workflows 动态发现工作流** _（已否决）_ — 优点：自动适配 pix2real 更新；缺点：pix2real 未启动时菜单空/加载态，体验差
- **multipart 上传二进制文件** _（已否决）_ — 优点：不依赖文件系统权限；缺点：需拷贝内存到网络，路径版更简单且同机可用

## 决策
采用 Zustand persist 将插件开关存 localStorage（key: serendip-plugins），通过唯一新增 IPC pluginP2VPush 走主进程发送：主进程从 media_files 表解析绝对路径，用 Node 全局 fetch POST 路径版 JSON 到 http://localhost:3000/api/external-image-push；工作流列表硬编码 11 项静态表；UI 复用现有 ContextMenu 子面板机制。

## 影响
优点：实现极简，无需新依赖或复杂 IPC；pix2real 未运行时有明确错误提示；渲染层无 CORS 问题。代价：工作流变更需手动更新静态表；pix2real 必须与 Serendip 同机运行且能访问相同文件系统路径。