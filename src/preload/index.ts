import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { SerendipAPI } from '../main/ipc/contract'
import { IPC } from '../main/ipc/contract'
import type { ScanProgress } from '../main/scanner'
import type { ExploreMode } from '../main/recommender'

const api: SerendipAPI = {
  selectRootDirectory: () => ipcRenderer.invoke(IPC.SELECT_ROOT),
  scanRoot: (rootPath: string) => ipcRenderer.invoke(IPC.SCAN_ROOT, rootPath),
  getCurrentRoot: () => ipcRenderer.invoke(IPC.GET_CURRENT_ROOT),
  getStats: () => ipcRenderer.invoke(IPC.GET_STATS),

  getRecommendations: (count: number, mode: ExploreMode) =>
    ipcRenderer.invoke(IPC.GET_RECOMMENDATIONS, count, mode),
  setLiked: (fileId: number, liked: boolean) =>
    ipcRenderer.invoke(IPC.SET_LIKED, fileId, liked),
  setDisliked: (fileId: number, disliked: boolean) =>
    ipcRenderer.invoke(IPC.SET_DISLIKED, fileId, disliked),
  markUnavailable: (fileId: number, reason: string) =>
    ipcRenderer.invoke(IPC.MARK_UNAVAILABLE, fileId, reason),
  revealInFolder: (fileId: number) => ipcRenderer.invoke(IPC.REVEAL_IN_FOLDER, fileId),

  onScanProgress: (callback: (progress: ScanProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: ScanProgress) => {
      callback(progress)
    }
    ipcRenderer.on(IPC.SCAN_PROGRESS, handler)
    return () => {
      ipcRenderer.off(IPC.SCAN_PROGRESS, handler)
    }
  }
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
