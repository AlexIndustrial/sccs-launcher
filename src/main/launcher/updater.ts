import {
  autoUpdater,
  type ProgressInfo,
  type UpdateCheckResult,
  type UpdateInfo
} from 'electron-updater'
import { app, dialog, type BrowserWindow } from 'electron'

/** Feed for dev mode: electron-updater can't read app-update.yml unpackaged. */
const DEV_FEED = {
  provider: 'github',
  owner: 'AlexIndustrial',
  repo: 'sccs-launcher',
  channel: 'latest'
} as const

type Win = BrowserWindow | null

interface Strings {
  updateFound: (version: string) => string
  updateFoundBody: (version: string) => string
  updateLater: string
  updateNow: string
  updateDownloading: string
  updateReadyBody: string
  updateRestart: string
}

const ru: Strings = {
  updateFound: (v) => `Доступно обновление ${v}`,
  updateFoundBody: (v) =>
    `Вышла новая версия лаунчера ${v}. Установить сейчас? Приложение перезапустится.`,
  updateLater: 'Позже',
  updateNow: 'Обновить',
  updateDownloading: 'Загрузка обновления…',
  updateReadyBody: 'Обновление скачано. Перезапустить и установить?',
  updateRestart: 'Перезапустить'
}

const en: Strings = {
  updateFound: (v) => `Update ${v} available`,
  updateFoundBody: (v) => `A new launcher version ${v} is out. Install now? The app will restart.`,
  updateLater: 'Later',
  updateNow: 'Update',
  updateDownloading: 'Downloading update…',
  updateReadyBody: 'Update downloaded. Restart and install?',
  updateRestart: 'Restart'
}

export interface AppUpdateProgress {
  percent: number
  transferred: number
  total: number
  bytesPerSecond: number
}

function toInfo(info: UpdateInfo): { version: string } {
  return { version: info.version }
}

/**
 * Wires the updater and shows a native dialog when a new version appears.
 * Called once from the main process after the window exists.
 */
export function setupAutoUpdater(getWindow: () => Win, getLang: () => 'ru' | 'en'): void {
  // Downloads only start after the user says yes in the dialog.
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  if (!app.isPackaged) {
    autoUpdater.setFeedURL(DEV_FEED)
  }

  autoUpdater.on('download-progress', (p: ProgressInfo) => {
    const win = getWindow()
    if (!win) return
    win.webContents.send('launcher:app-update-progress', {
      percent: p.percent,
      transferred: p.transferred,
      total: p.total,
      bytesPerSecond: p.bytesPerSecond
    } satisfies AppUpdateProgress)
  })

  // Background check right after the window shows up.
  setTimeout(() => {
    void checkInBackground(getWindow, getLang)
  }, 4000)
}

async function checkInBackground(getWindow: () => Win, getLang: () => 'ru' | 'en'): Promise<void> {
  let result: UpdateCheckResult | null = null
  try {
    result = (await autoUpdater.checkForUpdates()) as UpdateCheckResult | null
  } catch {
    // Network hiccup or dev mode: stay silent, this is a background nicety.
    return
  }
  if (!result?.updateInfo) return
  const win = getWindow()
  if (!win) return

  const S = getLang() === 'en' ? en : ru
  const info = toInfo(result.updateInfo)

  const answer = await dialog.showMessageBox(win, {
    type: 'info',
    title: S.updateFound(info.version),
    message: S.updateFound(info.version),
    detail: S.updateFoundBody(info.version),
    buttons: [S.updateNow, S.updateLater],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  })
  if (answer.response !== 0) return

  try {
    await autoUpdater.downloadUpdate()
  } catch {
    return
  }

  const ready = await dialog.showMessageBox(win, {
    type: 'info',
    title: S.updateFound(info.version),
    message: S.updateFound(info.version),
    detail: S.updateReadyBody,
    buttons: [S.updateRestart, S.updateLater],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  })
  if (ready.response === 0) {
    autoUpdater.quitAndInstall(false, true)
  }
}

/** Fallback for a manual "check for update" if we ever re-expose one. */
export async function checkForAppUpdate(): Promise<{ available: boolean; version?: string }> {
  const result = (await autoUpdater.checkForUpdates()) as UpdateCheckResult | null
  if (result?.updateInfo) return { available: true, version: result.updateInfo.version }
  return { available: false }
}
