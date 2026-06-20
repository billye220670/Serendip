import { ipcMain, dialog, shell, BrowserWindow } from 'electron'
import { existsSync } from 'fs'
import { IPC } from './contract'
import { getDatabase } from '../db'
import { scanRoot, type ScanProgress } from '../scanner'
import { recommend, getHierarchicalRecommendations, type ExploreMode } from '../recommender'
import {
  listCategories,
  createCategory,
  renameCategory,
  deleteCategory,
  reorderCategories,
  getCategoryItems,
  addItemsToCategory,
  removeItemFromCategory,
  removeItemsFromCategory,
  getFileCategoryIds
} from '../categories'
import {
  listCanvases,
  createCanvas,
  renameCanvas,
  deleteCanvas,
  reorderCanvases,
  getCanvasItems,
  addItemsToCanvas,
  addItemsToCanvasRaw,
  removeItemsFromCanvas,
  updateCanvasItem,
  updateCanvasItems,
  updateCanvasViewport,
  getFileCanvasIds,
  type CanvasItemInput,
  type CanvasItemFullInput,
  type CanvasItemPatch
} from '../canvases'
import { startWatcher } from '../watcher'

export function registerIpcHandlers(): void {
  // 选择根目录
  ipcMain.handle(IPC.SELECT_ROOT, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: '选择媒体根目录'
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // 扫描根目录（带进度推送）
  ipcMain.handle(IPC.SCAN_ROOT, async (event, rootPath: string) => {
    const sender = event.sender
    const onProgress = (progress: ScanProgress): void => {
      sender.send(IPC.SCAN_PROGRESS, progress)
    }
    const result = await scanRoot(rootPath, onProgress)
    startWatcher(rootPath)
    return result
  })

  // 获取当前根目录
  ipcMain.handle(IPC.GET_CURRENT_ROOT, () => {
    const db = getDatabase()
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('rootPath') as
      | { value: string }
      | undefined
    return row?.value ?? null
  })

  // 获取统计信息
  ipcMain.handle(IPC.GET_STATS, () => {
    const db = getDatabase()
    const totalFiles =
      (db.prepare('SELECT COUNT(*) as c FROM media_files').get() as { c: number }).c
    const totalFolders =
      (db.prepare('SELECT COUNT(*) as c FROM folders').get() as { c: number }).c
    const liked =
      (db.prepare('SELECT COUNT(*) as c FROM media_files WHERE liked = 1').get() as { c: number }).c
    return { totalFiles, totalFolders, liked }
  })

  // 获取推荐内容
  ipcMain.handle(IPC.GET_RECOMMENDATIONS, (_event, count: number, mode: ExploreMode, onlyUnrated?: boolean, scopePath?: string) => {
    return recommend({ count, mode, onlyUnrated, scopePath })
  })

  // 获取分层推荐内容（详情页右侧面板）
  ipcMain.handle(IPC.GET_HIERARCHICAL_RECOMMENDATIONS, (_event, folderPath: string, rootPath: string, count: number, mode: ExploreMode) => {
    return getHierarchicalRecommendations({ folderPath, rootPath, count, mode })
  })

  // 设置喜欢
  ipcMain.handle(IPC.SET_LIKED, (_event, fileId: number, liked: boolean) => {
    const db = getDatabase()
    db.prepare('UPDATE media_files SET liked = ? WHERE id = ?').run(liked ? 1 : 0, fileId)
  })

  // 设置不感兴趣
  ipcMain.handle(IPC.SET_DISLIKED, (_event, fileId: number, disliked: boolean) => {
    const db = getDatabase()
    db.prepare('UPDATE media_files SET disliked = ? WHERE id = ?').run(disliked ? 1 : 0, fileId)
  })

  // 批量设置喜欢（多选模式，事务批写）
  ipcMain.handle(IPC.SET_LIKED_BATCH, (_event, fileIds: number[], liked: boolean) => {
    if (fileIds.length === 0) return
    const db = getDatabase()
    const update = db.prepare('UPDATE media_files SET liked = ? WHERE id = ?')
    const txn = db.transaction((ids: number[]) => {
      for (const id of ids) update.run(liked ? 1 : 0, id)
    })
    txn(fileIds)
  })

  // 批量设置不感兴趣（多选模式，事务批写）
  ipcMain.handle(IPC.SET_DISLIKED_BATCH, (_event, fileIds: number[], disliked: boolean) => {
    if (fileIds.length === 0) return
    const db = getDatabase()
    const update = db.prepare('UPDATE media_files SET disliked = ? WHERE id = ?')
    const txn = db.transaction((ids: number[]) => {
      for (const id of ids) update.run(disliked ? 1 : 0, id)
    })
    txn(fileIds)
  })

  // 列出所有 liked 文件（限定在 rootPath 下、未失效）
  ipcMain.handle(IPC.LIST_LIKED, () => {
    const db = getDatabase()
    const rootRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('rootPath') as
      | { value: string }
      | undefined
    if (!rootRow) return []
    // 转义 LIKE 中的反斜杠 / % / _（Windows 路径含 `\`，与默认转义符冲突）
    const rootPrefix = rootRow.value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
    return db
      .prepare(
        `SELECT id, path, folder_path, type, width, height, duration_ms, liked, disliked
         FROM media_files
         WHERE liked = 1
           AND unavailable = 0
           AND path LIKE ? ESCAPE '\\'
         ORDER BY id DESC`
      )
      .all(rootPrefix + '%')
  })

  // 标记文件失效（缩略图生成失败 / 文件已删除 / 损坏）
  ipcMain.handle(IPC.MARK_UNAVAILABLE, (_event, fileId: number, reason: string) => {
    const db = getDatabase()
    db.prepare(
      'UPDATE media_files SET unavailable = 1, unavailable_reason = ? WHERE id = ?'
    ).run(reason, fileId)
  })

  // 在文件管理器中显示
  ipcMain.handle(IPC.REVEAL_IN_FOLDER, (_event, fileId: number) => {
    const db = getDatabase()
    const row = db.prepare('SELECT path FROM media_files WHERE id = ?').get(fileId) as
      | { path: string }
      | undefined
    if (!row) return
    if (!existsSync(row.path)) {
      // 文件已不存在，顺便标记失效
      db.prepare(
        'UPDATE media_files SET unavailable = 1, unavailable_reason = ? WHERE id = ?'
      ).run('missing', fileId)
      return
    }
    shell.showItemInFolder(row.path)
  })

  // 用系统默认应用打开文件
  ipcMain.handle(IPC.OPEN_FILE, (_event, fileId: number) => {
    const db = getDatabase()
    const row = db.prepare('SELECT path FROM media_files WHERE id = ?').get(fileId) as
      | { path: string }
      | undefined
    if (!row) return
    void shell.openPath(row.path)
  })

  ipcMain.handle(IPC.OPEN_FOLDER, (_event, folderPath: string) => {
    void shell.openPath(folderPath)
  })

  // ===== 收藏分类 =====
  ipcMain.handle(IPC.LIST_CATEGORIES, () => listCategories())
  ipcMain.handle(IPC.CREATE_CATEGORY, (_event, name: string) => createCategory(name))
  ipcMain.handle(IPC.RENAME_CATEGORY, (_event, id: number, newName: string) =>
    renameCategory(id, newName)
  )
  ipcMain.handle(IPC.DELETE_CATEGORY, (_event, id: number) => deleteCategory(id))
  ipcMain.handle(IPC.REORDER_CATEGORIES, (_event, orderedIds: number[]) =>
    reorderCategories(orderedIds)
  )
  ipcMain.handle(IPC.GET_CATEGORY_ITEMS, (_event, categoryId: number) =>
    getCategoryItems(categoryId)
  )
  ipcMain.handle(IPC.ADD_ITEMS_TO_CATEGORY, (_event, categoryId: number, fileIds: number[]) =>
    addItemsToCategory(categoryId, fileIds)
  )
  ipcMain.handle(IPC.REMOVE_ITEM_FROM_CATEGORY, (_event, categoryId: number, fileId: number) =>
    removeItemFromCategory(categoryId, fileId)
  )
  ipcMain.handle(IPC.REMOVE_ITEMS_FROM_CATEGORY, (_event, categoryId: number, fileIds: number[]) =>
    removeItemsFromCategory(categoryId, fileIds)
  )
  ipcMain.handle(IPC.GET_FILE_CATEGORY_IDS, (_event, fileId: number) =>
    getFileCategoryIds(fileId)
  )

  // ===== 画布 =====
  ipcMain.handle(IPC.LIST_CANVASES, () => listCanvases())
  ipcMain.handle(IPC.CREATE_CANVAS, (_event, name: string) => createCanvas(name))
  ipcMain.handle(IPC.RENAME_CANVAS, (_event, id: number, newName: string) =>
    renameCanvas(id, newName)
  )
  ipcMain.handle(IPC.DELETE_CANVAS, (_event, id: number) => deleteCanvas(id))
  ipcMain.handle(IPC.REORDER_CANVASES, (_event, orderedIds: number[]) =>
    reorderCanvases(orderedIds)
  )
  ipcMain.handle(IPC.GET_CANVAS_ITEMS, (_event, canvasId: number) =>
    getCanvasItems(canvasId)
  )
  ipcMain.handle(IPC.ADD_ITEMS_TO_CANVAS, (_event, canvasId: number, items: CanvasItemInput[]) =>
    addItemsToCanvas(canvasId, items)
  )
  ipcMain.handle(
    IPC.ADD_ITEMS_TO_CANVAS_RAW,
    (_event, canvasId: number, items: CanvasItemFullInput[]) => addItemsToCanvasRaw(canvasId, items)
  )
  ipcMain.handle(IPC.REMOVE_ITEMS_FROM_CANVAS, (_event, canvasId: number, itemIds: number[]) =>
    removeItemsFromCanvas(canvasId, itemIds)
  )
  ipcMain.handle(IPC.UPDATE_CANVAS_ITEM, (_event, itemId: number, patch: Omit<CanvasItemPatch, 'id'>) =>
    updateCanvasItem(itemId, patch)
  )
  ipcMain.handle(IPC.UPDATE_CANVAS_ITEMS, (_event, patches: CanvasItemPatch[]) =>
    updateCanvasItems(patches)
  )
  ipcMain.handle(IPC.UPDATE_CANVAS_VIEWPORT, (_event, canvasId: number, x: number, y: number, scale: number) =>
    updateCanvasViewport(canvasId, x, y, scale)
  )
  ipcMain.handle(IPC.GET_FILE_CANVAS_IDS, (_event, fileId: number) =>
    getFileCanvasIds(fileId)
  )

  // ===== 窗口装饰 =====
  // 设置 WCO（Windows Controls Overlay）的可见性与符号色。
  // - 详情页打开 → 仍保持可见，业务区让出顶部 64px（见渲染层 Detail.tsx 的 padding）
  // - 主题切换 → 重设 color + symbolColor，让按钮区与 header 视觉协调
  //   color 不能用全透明：透明背景下 OS 自绘的 hover 高亮（半透灰）在亮色主题下几乎看不出来
  //   所以这里给一个接近 header 玻璃态视觉的近似色，让 hover 时 Windows 的暗一档高亮可见
  // macOS 走默认 hidden 信号灯，setWindowControlsOverlay 不存在，调用直接静默返回。
  ipcMain.handle(
    IPC.SET_TITLE_BAR_OVERLAY,
    (event, opts: { visible?: boolean; theme?: 'light' | 'dark'; color?: string; symbolColor?: string }) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) return

      const isDark = opts.theme === 'dark'
      // color/symbolColor 直接传入时优先使用，否则由 theme 派生
      // 详情页传 '#00000000' 全透明，沉浸式；主页传略实色让 OS hover 高亮可见
      // 亮色：接近 glass-over-background 的温暖近白；暗色：接近 glass-over-background 的近黑
      const color = opts.color ?? (isDark ? '#111009' : '#d9d6d3')
      const symbolColor = opts.symbolColor ?? (isDark ? '#cccccc' : '#444444')

      try {
        // Electron 28+ 正式 API：win.setTitleBarOverlay()
        // macOS 无 WCO，调用会抛异常，catch 静默处理
        win.setTitleBarOverlay({
          color: opts.visible === false ? color : color,
          symbolColor: opts.visible === false ? '#00000000' : symbolColor
        })
      } catch {
        // macOS 等不支持 WCO 的平台静默忽略
      }
    }
  )
}

// 工具：向所有窗口广播进度（用于在异步过程中通知渲染层）
export function broadcastProgress(progress: ScanProgress): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.SCAN_PROGRESS, progress)
  }
}
