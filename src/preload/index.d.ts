import { ElectronAPI } from '@electron-toolkit/preload'
import type { LauncherAPI } from './index'

declare global {
  interface Window {
    electron: ElectronAPI
    api: LauncherAPI
  }
}
