import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Types mirror src/main/launcher/*.ts (keep preload independent from main).
// Mirrors DEFAULT_SERVER from src/main/launcher/config.ts.
export const DEFAULT_SERVER = 'https://cdn.sccs.dsrt.app'

export interface LauncherConfig {
  serverUrl: string
  servers: string[]
  installDir: string
  exeRelPath: string
  concurrency: number
}

export interface ManifestFile {
  path: string
  size: number
  sha256: string
  mtime?: number
}

export interface CheckResult {
  version: string
  totalFiles: number
  totalBytes: number
  toUpdate: ManifestFile[]
  toUpdateBytes: number
  upToDate: boolean
}

export interface ProgressEvent {
  phase: 'check' | 'download'
  overallRatio: number
  doneBytes: number
  totalBytes: number
  filePath: string
  fileDoneBytes: number
  fileSize: number
  fileIndex: number
  fileCount: number
}

export interface AppUpdateInfo {
  version: string
  releaseDate: string
  releaseNotes: string | null
}

export interface AppUpdateProgress {
  percent: number
  transferred: number
  total: number
  bytesPerSecond: number
}

export type AppUpdateState =
  'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'ready' | 'error'

const api = {
  defaultServer: DEFAULT_SERVER,
  getConfig: (): Promise<LauncherConfig> => ipcRenderer.invoke('launcher:get-config'),
  setConfig: (patch: Partial<LauncherConfig>): Promise<LauncherConfig> =>
    ipcRenderer.invoke('launcher:set-config', patch),
  check: (full?: boolean): Promise<CheckResult> => ipcRenderer.invoke('launcher:check', full),
  update: (): Promise<{ updated: number; version: string }> =>
    ipcRenderer.invoke('launcher:update'),
  play: (): Promise<{ pid: number }> => ipcRenderer.invoke('launcher:play'),
  pickDir: (): Promise<string | null> => ipcRenderer.invoke('launcher:pick-dir'),
  fitWindow: (height: number): Promise<void> => ipcRenderer.invoke('launcher:fit-window', height),

  checkAppUpdate: (): Promise<{ available: boolean; info?: AppUpdateInfo }> =>
    ipcRenderer.invoke('launcher:update-check'),
  downloadAppUpdate: (): Promise<AppUpdateInfo | null> =>
    ipcRenderer.invoke('launcher:update-download'),
  installAppUpdate: (): Promise<void> => ipcRenderer.invoke('launcher:update-install'),
  onAppUpdate: (cb: (state: AppUpdateState, payload: unknown) => void): (() => void) => {
    const listener = (_e: unknown, msg: { state: AppUpdateState; payload?: unknown }): void =>
      cb(msg.state, msg.payload)
    ipcRenderer.on('launcher:app-update', listener as never)
    return () => ipcRenderer.removeListener('launcher:app-update', listener as never)
  },

  onProgress: (cb: (p: ProgressEvent) => void): (() => void) => {
    const listener = (_e: unknown, p: ProgressEvent): void => cb(p)
    ipcRenderer.on('launcher:progress', listener as never)
    return () => ipcRenderer.removeListener('launcher:progress', listener as never)
  }
}

export type LauncherAPI = typeof api

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
