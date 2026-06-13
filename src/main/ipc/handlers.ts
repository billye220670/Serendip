import { ipcMain, dialog, shell, BrowserWindow } from 'electron'
import { existsSync } from 'fs'
import { IPC } from './contract'
import { getDatabase } from '../db'
import { scanRoot, type ScanProgress } from '../scanner'
import { recommend, type ExploreMode } from '../recommender'
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
  ipcMain.handle(IPC.GET_RECOMMENDATIONS, (_event, count: number, mode: ExploreMode, onlyUnrated?: boolean) => {
    return recommend({ count, mode, onlyUnrated })
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
}

// 工具：向所有窗口广播进度（用于在异步过程中通知渲染层）
export function broadcastProgress(progress: ScanProgress): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.SCAN_PROGRESS, progress)
  }
}
