import { ElectronAPI } from '@electron-toolkit/preload'
import type { SerendipAPI } from '../main/ipc/contract'

declare global {
  interface Window {
    electron: ElectronAPI
    api: SerendipAPI
  }
}
