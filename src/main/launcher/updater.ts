import {
  autoUpdater,
  type ProgressInfo,
  type UpdateCheckResult,
  type UpdateInfo
} from 'electron-updater'
import { app } from 'electron'

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

export type UpdateState =
  'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'ready' | 'error'

/** Feed for dev mode: electron-updater can't read app-update.yml unpackaged. */
const DEV_FEED = {
  provider: 'github',
  owner: 'AlexIndustrial',
  repo: 'sccs-launcher',
  channel: 'latest'
} as const

function toInfo(info: UpdateInfo): AppUpdateInfo {
  return {
    version: info.version,
    releaseDate: info.releaseDate ?? '',
    releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : null
  }
}

function toProgress(p: ProgressInfo): AppUpdateProgress {
  return {
    percent: p.percent,
    transferred: p.transferred,
    total: p.total,
    bytesPerSecond: p.bytesPerSecond
  }
}

/** Wires updater events to the renderer. Must be called once, after app ready. */
export function setupAutoUpdater(onEvent: (state: UpdateState, payload?: unknown) => void): void {
  // We drive downloads manually so the user stays in control.
  autoUpdater.autoDownload = false
  // Still install silently on quit if the user downloaded but never clicked.
  autoUpdater.autoInstallOnAppQuit = true

  if (!app.isPackaged) {
    autoUpdater.setFeedURL(DEV_FEED)
  }

  autoUpdater.on('checking-for-update', () => onEvent('checking'))

  autoUpdater.on('update-available', (info: UpdateInfo) => onEvent('available', toInfo(info)))

  autoUpdater.on('update-not-available', () => onEvent('not-available'))

  autoUpdater.on('download-progress', (p: ProgressInfo) => onEvent('downloading', toProgress(p)))

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => onEvent('ready', toInfo(info)))

  autoUpdater.on('error', (err: Error) => onEvent('error', err.message ?? String(err)))
}

/** Manual check. Returns the update info when a newer version exists. */
export async function checkForAppUpdate(): Promise<{ available: boolean; info?: AppUpdateInfo }> {
  const result = (await autoUpdater.checkForUpdates()) as UpdateCheckResult | null
  if (result?.updateInfo) {
    return { available: true, info: toInfo(result.updateInfo) }
  }
  return { available: false }
}

export async function downloadAppUpdate(): Promise<AppUpdateInfo | null> {
  await autoUpdater.downloadUpdate()
  return null
}

export function quitAndInstall(): void {
  autoUpdater.quitAndInstall(false, true)
}
