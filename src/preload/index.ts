import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { SerendipAPI } from '../main/ipc/contract'
import { IPC } from '../main/ipc/contract'
import type { ScanProgress } from '../main/scanner'
import type { ExploreMode } from '../main/recommender'
import type { CanvasItemInput, CanvasItemFullInput, CanvasItemPatch } from '../main/canvases'

const api: SerendipAPI = {
  selectRootDirectory: () => ipcRenderer.invoke(IPC.SELECT_ROOT),
  scanRoot: (rootPath: string) => ipcRenderer.invoke(IPC.SCAN_ROOT, rootPath),
  getCurrentRoot: () => ipcRenderer.invoke(IPC.GET_CURRENT_ROOT),
  getStats: () => ipcRenderer.invoke(IPC.GET_STATS),

  getRecommendations: (count: number, mode: ExploreMode, onlyUnrated?: boolean, scopePath?: string) =>
    ipcRenderer.invoke(IPC.GET_RECOMMENDATIONS, count, mode, onlyUnrated, scopePath),
  getHierarchicalRecommendations: (folderPath: string, rootPath: string, count: number, mode: ExploreMode) =>
    ipcRenderer.invoke(IPC.GET_HIERARCHICAL_RECOMMENDATIONS, folderPath, rootPath, count, mode),
  setLiked: (fileId: number, liked: boolean) =>
    ipcRenderer.invoke(IPC.SET_LIKED, fileId, liked),
  setDisliked: (fileId: number, disliked: boolean) =>
    ipcRenderer.invoke(IPC.SET_DISLIKED, fileId, disliked),
  setLikedBatch: (fileIds: number[], liked: boolean) =>
    ipcRenderer.invoke(IPC.SET_LIKED_BATCH, fileIds, liked),
  setDislikedBatch: (fileIds: number[], disliked: boolean) =>
    ipcRenderer.invoke(IPC.SET_DISLIKED_BATCH, fileIds, disliked),
  listLiked: () => ipcRenderer.invoke(IPC.LIST_LIKED),
  markUnavailable: (fileId: number, reason: string) =>
    ipcRenderer.invoke(IPC.MARK_UNAVAILABLE, fileId, reason),
  revealInFolder: (fileId: number) => ipcRenderer.invoke(IPC.REVEAL_IN_FOLDER, fileId),
  openFile: (fileId: number) => ipcRenderer.invoke(IPC.OPEN_FILE, fileId),
  openFolder: (folderPath: string) => ipcRenderer.invoke(IPC.OPEN_FOLDER, folderPath),

  listCategories: () => ipcRenderer.invoke(IPC.LIST_CATEGORIES),
  createCategory: (name: string) => ipcRenderer.invoke(IPC.CREATE_CATEGORY, name),
  renameCategory: (id: number, newName: string) =>
    ipcRenderer.invoke(IPC.RENAME_CATEGORY, id, newName),
  deleteCategory: (id: number) => ipcRenderer.invoke(IPC.DELETE_CATEGORY, id),
  reorderCategories: (orderedIds: number[]) =>
    ipcRenderer.invoke(IPC.REORDER_CATEGORIES, orderedIds),
  getCategoryItems: (categoryId: number) =>
    ipcRenderer.invoke(IPC.GET_CATEGORY_ITEMS, categoryId),
  addItemsToCategory: (categoryId: number, fileIds: number[]) =>
    ipcRenderer.invoke(IPC.ADD_ITEMS_TO_CATEGORY, categoryId, fileIds),
  removeItemFromCategory: (categoryId: number, fileId: number) =>
    ipcRenderer.invoke(IPC.REMOVE_ITEM_FROM_CATEGORY, categoryId, fileId),
  removeItemsFromCategory: (categoryId: number, fileIds: number[]) =>
    ipcRenderer.invoke(IPC.REMOVE_ITEMS_FROM_CATEGORY, categoryId, fileIds),
  getFileCategoryIds: (fileId: number) =>
    ipcRenderer.invoke(IPC.GET_FILE_CATEGORY_IDS, fileId),

  listCanvases: () => ipcRenderer.invoke(IPC.LIST_CANVASES),
  createCanvas: (name: string) => ipcRenderer.invoke(IPC.CREATE_CANVAS, name),
  renameCanvas: (id: number, newName: string) =>
    ipcRenderer.invoke(IPC.RENAME_CANVAS, id, newName),
  deleteCanvas: (id: number) => ipcRenderer.invoke(IPC.DELETE_CANVAS, id),
  reorderCanvases: (orderedIds: number[]) =>
    ipcRenderer.invoke(IPC.REORDER_CANVASES, orderedIds),
  getCanvasItems: (canvasId: number) =>
    ipcRenderer.invoke(IPC.GET_CANVAS_ITEMS, canvasId),
  getMediaDimensions: (fileIds: number[]) =>
    ipcRenderer.invoke(IPC.GET_MEDIA_DIMENSIONS, fileIds),
  addItemsToCanvas: (canvasId: number, items: CanvasItemInput[]) =>
    ipcRenderer.invoke(IPC.ADD_ITEMS_TO_CANVAS, canvasId, items),
  addItemsToCanvasRaw: (canvasId: number, items: CanvasItemFullInput[]) =>
    ipcRenderer.invoke(IPC.ADD_ITEMS_TO_CANVAS_RAW, canvasId, items),
  removeItemsFromCanvas: (canvasId: number, itemIds: number[]) =>
    ipcRenderer.invoke(IPC.REMOVE_ITEMS_FROM_CANVAS, canvasId, itemIds),
  updateCanvasItem: (itemId: number, patch: Omit<CanvasItemPatch, 'id'>) =>
    ipcRenderer.invoke(IPC.UPDATE_CANVAS_ITEM, itemId, patch),
  updateCanvasItems: (patches: CanvasItemPatch[]) =>
    ipcRenderer.invoke(IPC.UPDATE_CANVAS_ITEMS, patches),
  updateCanvasViewport: (canvasId: number, x: number, y: number, scale: number) =>
    ipcRenderer.invoke(IPC.UPDATE_CANVAS_VIEWPORT, canvasId, x, y, scale),
  getFileCanvasIds: (fileId: number) =>
    ipcRenderer.invoke(IPC.GET_FILE_CANVAS_IDS, fileId),

  pluginP2VPush: (fileIds: number[], workflowId: number, port?: number) =>
    ipcRenderer.invoke(IPC.PLUGIN_P2V_PUSH, fileIds, workflowId, port),

  onScanProgress: (callback: (progress: ScanProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: ScanProgress) => {
      callback(progress)
    }
    ipcRenderer.on(IPC.SCAN_PROGRESS, handler)
    return () => {
      ipcRenderer.off(IPC.SCAN_PROGRESS, handler)
    }
  },

  setTitleBarOverlay: (opts) => ipcRenderer.invoke(IPC.SET_TITLE_BAR_OVERLAY, opts)
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
