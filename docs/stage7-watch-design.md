# 阶段 7：实时监听 + 启动增量同步 + 手动刷新

**设计文档** | 2026-06-14

---

## 目标

让 Serendip 自动追踪文件系统变化，无需用户手动点"重新扫描"：

1. **启动时增量同步** — app 启动时若已配置 rootPath，自动跑一次增量扫描
2. **实时监听文件变化** — chokidar 监听 add/change/unlink，批处理后更新 DB
3. **手动刷新保留** — 已有"重新扫描"按钮，作为兜底/强制全量刷新入口

---

## 技术方案

### 1. 新增模块：`src/main/watcher/index.ts`

封装 chokidar 监听逻辑，提供 `startWatcher(rootPath)` / `stopWatcher()`。

#### 关键设计点

**a) 过滤规则**（与 scanner 一致）
```typescript
ignored: [
  /(^|[\/\\])\../,               // 隐藏文件/目录
  '**/node_modules/**',
  '**/.serendip-cache/**',
  '**/System Volume Information/**',
  '**/$RECYCLE.BIN/**'
]
```

**b) 批处理防抖**
- 单个文件变化立即入队，但延迟 500ms 批量写入 DB
- 避免大量复制粘贴时每个文件触发一次写入
- 用 `changeQueue: FileChange[]` + `flushTimer` 实现

**c) 事件映射**
| chokidar 事件 | 操作 | SQL |
|---------------|------|-----|
| `add` | 新增文件 | `INSERT INTO media_files` |
| `change` | 更新 mtime/size，清除 unavailable | `UPDATE media_files SET mtime=?, size=?, unavailable=0` |
| `unlink` | 删除记录 | `DELETE FROM media_files WHERE path=?` |

**d) 稳定性配置**
```typescript
awaitWriteFinish: {
  stabilityThreshold: 500,  // 文件停止写入 500ms 后才触发
  pollInterval: 100
}
```
避免文件写一半就触发 `add` 事件。

#### 实现骨架

```typescript
import chokidar from 'chokidar'
import { getDatabase } from '../db'
import { getMediaType, CACHE_DIR_NAME } from '../media-types'
import { stat } from 'fs/promises'
import { dirname, extname } from 'path'

interface FileChange {
  type: 'add' | 'change' | 'unlink'
  path: string
}

let watcher: chokidar.FSWatcher | null = null
let changeQueue: FileChange[] = []
let flushTimer: NodeJS.Timeout | null = null

export function startWatcher(rootPath: string): void {
  stopWatcher()
  
  watcher = chokidar.watch(rootPath, {
    ignored: [/* ... */],
    ignoreInitial: true,  // 不触发初始扫描（startup 时已跑过 scanRoot）
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 }
  })

  watcher
    .on('add', path => queueChange({ type: 'add', path }))
    .on('change', path => queueChange({ type: 'change', path }))
    .on('unlink', path => queueChange({ type: 'unlink', path }))
    .on('error', error => console.error('Watcher error:', error))
}

export function stopWatcher(): void {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushChanges() // 立即刷新队列，避免丢失
    flushTimer = null
  }
  if (watcher) {
    void watcher.close()
    watcher = null
  }
  changeQueue = []
}

function queueChange(change: FileChange): void {
  const ext = extname(change.path).toLowerCase()
  if (!getMediaType(ext)) return  // 过滤非媒体文件

  changeQueue.push(change)
  scheduleFlush()
}

function scheduleFlush(): void {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    flushChanges()
  }, 500)
}

function flushChanges(): void {
  if (changeQueue.length === 0) return
  const batch = changeQueue.splice(0)
  
  const db = getDatabase()
  const tx = db.transaction(() => {
    for (const change of batch) {
      try {
        if (change.type === 'add' || change.type === 'change') {
          const s = await stat(change.path)  // ❌ transaction 内不能 await
          // 需要改：先批量 stat，再 transaction
        } else if (change.type === 'unlink') {
          db.prepare('DELETE FROM media_files WHERE path = ?').run(change.path)
        }
      } catch (err) { /* ignore */ }
    }
  })
  tx()
}
```

**注意**：transaction 内不能 `await`（better-sqlite3 是同步的），需要先批量 `stat` 所有文件，再进事务。修正版：

```typescript
async function flushChanges(): Promise<void> {
  if (changeQueue.length === 0) return
  const batch = changeQueue.splice(0)
  
  const db = getDatabase()
  
  // 1) 先批量 stat（异步）
  const statsMap = new Map<string, { mtime: number; size: number }>()
  await Promise.all(
    batch.map(async (change) => {
      if (change.type === 'add' || change.type === 'change') {
        try {
          const s = await stat(change.path)
          statsMap.set(change.path, { mtime: Math.floor(s.mtimeMs), size: s.size })
        } catch { /* file disappeared, skip */ }
      }
    })
  )
  
  // 2) 再进事务批量写（同步）
  const insertStmt = db.prepare(`
    INSERT INTO media_files (path, folder_path, type, mtime, size)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET mtime=excluded.mtime, size=excluded.size, unavailable=0, unavailable_reason=NULL
  `)
  const deleteStmt = db.prepare('DELETE FROM media_files WHERE path = ?')
  
  const tx = db.transaction(() => {
    let added = 0, updated = 0, removed = 0
    
    for (const change of batch) {
      const ext = extname(change.path).toLowerCase()
      const mediaType = getMediaType(ext)
      if (!mediaType) continue
      
      if (change.type === 'add' || change.type === 'change') {
        const s = statsMap.get(change.path)
        if (!s) continue
        const info = insertStmt.run(
          change.path,
          dirname(change.path),
          mediaType,
          s.mtime,
          s.size
        )
        if (info.changes > 0) {
          // 判断是 insert 还是 update（通过查 changes）比较麻烦，简化统计
          added++
        }
      } else if (change.type === 'unlink') {
        const info = deleteStmt.run(change.path)
        if (info.changes > 0) removed++
      }
    }
    
    if (added + removed > 0) {
      console.log(`[Watcher] Processed: +${added} -${removed}`)
    }
  })
  tx()
}
```

---

### 2. 修改 `src/main/index.ts`：启动时同步 + 启动监听

```typescript
import { startWatcher, stopWatcher } from './watcher'

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.serendip')
  
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  const db = getDatabase()
  registerThumbProtocol()
  registerIpcHandlers()

  // ===== 启动时增量同步 =====
  const rootRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('rootPath') as
    | { value: string } | undefined
  
  if (rootRow?.value) {
    console.log('[Startup] Auto-syncing root:', rootRow.value)
    try {
      // 静默扫描（不推送进度到渲染进程，避免启动就弹进度面板）
      await scanRoot(rootRow.value)
      console.log('[Startup] Sync complete, starting watcher')
      startWatcher(rootRow.value)
    } catch (err) {
      console.error('[Startup] Sync failed:', err)
    }
  }

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  stopWatcher()
  closeDatabase()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
```

**关键点**：
- 在 `getDatabase()` 之后、`createWindow()` 之前执行
- 静默扫描（不传 `onProgress` 回调）
- 扫描完成后立即启动监听器
- 失败不阻塞窗口创建（用户可以手动重新扫描）

---

### 3. 修改 `src/main/ipc/handlers.ts`：用户切换根目录时重启监听

```typescript
import { startWatcher } from '../watcher'

ipcMain.handle(IPC.SCAN_ROOT, async (event, rootPath: string) => {
  const sender = event.sender
  const onProgress = (progress: ScanProgress): void => {
    sender.send(IPC.SCAN_PROGRESS, progress)
  }
  
  const result = await scanRoot(rootPath, onProgress)
  
  // 扫描完成后启动/重启监听器
  startWatcher(rootPath)
  
  return result
})
```

**场景**：用户点"更换根目录" → 选新目录 → scanRoot → 启动新监听器（旧的会在 `startWatcher` 开头被 `stopWatcher` 停掉）

---

### 4. 不实现的部分（简化设计）

**a) 实时更新 `folders` 表**
- 当前 `folders` 表在 `scanRoot` 最后通过 `rebuildFolderStats` 完整重建
- 实时监听时不更新 `folders`：
  - 推荐算法实际是从 `media_files` 实时聚合 `GROUP BY folder_path`，不依赖 `folders` 表
  - `folders` 表主要用于未来可能的"按文件夹浏览"功能
- 权衡：简化实现，下次手动 `scanRoot` 时会完整重建

**b) 推送变化通知到前端**
- 不新增 `IPC.FILE_CHANGES` 事件
- 用户下次刷新视图时自然看到新文件/删除的文件
- 避免频繁通知打扰用户

**c) 增量更新视图**
- 探索视图：无限滚动，自然获取新数据
- 分类视图：下次切换进来时重新加载
- 评审视图：队列耗尽后再拉取时能看到新增
- 不做主动刷新（用户可以手动切视图或点重新扫描）

---

## 边界情况处理

| 场景 | 行为 |
|------|------|
| 启动时无 rootPath | 跳过同步，不启动监听器；用户选择根目录后触发 |
| 监听器崩溃 | `watcher.on('error')` 记录日志，不让 app 崩溃 |
| 根目录切换 | `startWatcher` 开头调用 `stopWatcher`，旧监听器自动停止 |
| 文件重命名 | chokidar 触发 `unlink`(旧) + `add`(新)，DB 删旧记录插新记录（合理：路径是主键） |
| 文件夹移动 | 触发大量 unlink + add，批处理合并，几秒后同步完成 |
| 批量复制文件 | 500ms 防抖窗口合并为一次事务写入 |
| 外部程序锁文件 | `awaitWriteFinish` 等文件稳定后才触发，`stat` 失败则跳过该文件 |
| app 关闭 | `stopWatcher` 立即 flush 队列，避免丢失最后一批变化 |

---

## 性能考虑

1. **监听器开销**
   - chokidar 底层用 OS 原生 API（Windows: ReadDirectoryChangesW，macOS: FSEvents，Linux: inotify）
   - 已通过 `ignored` 排除大量无关文件
   - 监听几万个媒体文件可接受

2. **批处理策略**
   - 500ms 窗口避免单文件多次写入
   - 事务批量写入（better-sqlite3 WAL 模式），性能足够

3. **数据库锁**
   - better-sqlite3 同步 API + WAL 模式，读写并发良好
   - 监听器写入与推荐算法读取不冲突

4. **内存占用**
   - `changeQueue` 通常很小（< 100 项）
   - 批量 `stat` 的 Promise 数组也会很快释放

---

## 用户体验

**启动时**
- 静默增量同步（几秒内完成）
- 窗口正常打开，用户无感知
- 若文件很多（首次扫描），可能稍慢，但不阻塞 UI（异步）

**使用中**
- 外部添加/删除文件 → 自动同步到 DB
- 下次浏览时自然看到变化
- 无弹窗通知（不打扰）

**手动刷新**
- 保留"重新扫描"按钮作为兜底
- 用户怀疑数据不同步时可手动触发
- 实时监听启用后，此按钮使用频率大幅降低

---

## 测试清单

### 手动测试项

**启动时同步**
- [ ] 首次启动（无 rootPath）→ 不触发同步
- [ ] 选择根目录 → 扫描 → 再重启 app → 自动增量同步（无进度面板）
- [ ] 重启期间外部新增文件 → 启动时同步能发现

**实时监听：添加**
- [ ] 外部复制一张图片到根目录 → 探索视图下次加载时能看到
- [ ] 批量复制 100 张图片 → 日志显示批处理合并，DB 无遗漏

**实时监听：删除**
- [ ] 外部删除一张图片 → DB 记录消失，探索视图不再推荐
- [ ] 删除一个文件夹 → 该文件夹下所有文件从 DB 移除

**实时监听：修改**
- [ ] 外部编辑图片（如 PS 保存） → mtime/size 更新，unavailable 清零

**切换根目录**
- [ ] 更换根目录 → 旧监听器停止，新监听器启动
- [ ] 在旧根目录外部新增文件 → 不触发监听（已停止）
- [ ] 在新根目录外部新增文件 → 触发监听

**边界情况**
- [ ] 重命名文件 → DB 旧路径删除，新路径插入（liked/disliked 等评级丢失，合理）
- [ ] 移动文件夹 → 触发大量 unlink + add，最终 DB 同步正确
- [ ] 文件被外部程序锁定 → `stat` 失败，跳过该文件，不崩溃

**稳定性**
- [ ] 长时间运行（几小时）→ 监听器正常工作，无内存泄漏
- [ ] 外部程序高频读写（如视频编码输出）→ `awaitWriteFinish` 避免过早触发

---

## 实现检查清单

- [ ] 创建 `src/main/watcher/index.ts`
  - [ ] `startWatcher(rootPath)`
  - [ ] `stopWatcher()`
  - [ ] `queueChange` + 500ms 批处理
  - [ ] `flushChanges` 事务写入
  - [ ] 错误处理（`watcher.on('error')`）

- [ ] 修改 `src/main/index.ts`
  - [ ] `app.whenReady()` 后读 rootPath
  - [ ] 静默调用 `scanRoot`（不传 onProgress）
  - [ ] 成功后 `startWatcher`
  - [ ] `window-all-closed` 时 `stopWatcher`

- [ ] 修改 `src/main/ipc/handlers.ts`
  - [ ] `IPC.SCAN_ROOT` 成功后调用 `startWatcher(rootPath)`

- [ ] （可选）更新 `CLAUDE.md`
  - [ ] 添加 `src/main/watcher/` 说明
  - [ ] 更新启动流程描述

---

## 后续优化（阶段 8+）

1. **增量更新 folders 表**
   - 实时监听时也更新 `folders.file_count`
   - 避免依赖手动 scanRoot 重建

2. **前端轻量级通知**
   - 新增 `IPC.FILE_CHANGES` 事件
   - 前端显示一个小 toast："发现 X 个新文件"
   - 不强制刷新视图（用户自主决定）

3. **智能刷新策略**
   - 分类视图：检测当前分类的文件是否有删除 → 自动重载
   - 评审视图：队列低于阈值时自动补充新文件

4. **监听器暂停/恢复**
   - app 进入后台时暂停监听（节省资源）
   - 回到前台时恢复监听 + 跑一次快速 diff

---

## 文件清单总结

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/main/watcher/index.ts` | **新增** | chokidar 监听器封装 |
| `src/main/index.ts` | **修改** | 启动时同步 + 启动监听 + 退出时停止 |
| `src/main/ipc/handlers.ts` | **修改** | SCAN_ROOT 后启动监听 |
| `CLAUDE.md` | **可选修改** | 更新架构说明 |

---

## 实现时机建议

建议分两步实现：

**Step 1（核心）**：
- 创建 `watcher/index.ts` 基础版（仅 add/unlink，不含 change）
- 启动时同步
- 测试添加/删除

**Step 2（完善）**：
- 补充 `change` 事件处理
- 完善错误处理
- 压力测试（大量文件批量操作）

---

**设计定稿** | 待 Sonnet 实现
