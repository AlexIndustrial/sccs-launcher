import { dialog, ipcMain, screen, type BrowserWindow } from 'electron'
import { loadConfig, saveConfig } from './config'
import { checkForUpdates, fetchManifest } from './manifest'
import { downloadFiles, type ProgressEvent } from './downloader'
import { playGame } from './game'

function senderWindow(win: BrowserWindow | null): BrowserWindow | null {
  return win
}

/** Регистрирует IPC лаунчера. `getWindow` — для push-а прогресса. */
export function registerLauncherIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('launcher:get-config', async () => loadConfig())

  ipcMain.handle('launcher:set-config', async (_e, patch) => saveConfig(patch ?? {}))

  ipcMain.handle('launcher:check', async (_e, full?: boolean) => {
    const cfg = await loadConfig()
    const manifest = await fetchManifest(cfg.serverUrl)
    const win = senderWindow(getWindow())
    const result = await checkForUpdates(
      manifest,
      cfg.installDir,
      (p) => {
        win?.webContents.send('launcher:progress', p)
      },
      { forceHash: full === true, concurrency: cfg.concurrency }
    )
    return result
  })

  ipcMain.handle('launcher:update', async () => {
    const cfg = await loadConfig()
    const manifest = await fetchManifest(cfg.serverUrl)
    const win = senderWindow(getWindow())
    const onProgress = (p: ProgressEvent): void => {
      win?.webContents.send('launcher:progress', p)
    }
    const checked = await checkForUpdates(manifest, cfg.installDir, onProgress, {
      concurrency: cfg.concurrency
    })
    if (checked.upToDate) return { updated: 0, version: manifest.version }

    await downloadFiles(cfg.serverUrl, cfg.installDir, checked.toUpdate, onProgress, {
      concurrency: cfg.concurrency
    })

    // финальная перепроверка
    const recheck = await checkForUpdates(manifest, cfg.installDir, onProgress, {
      concurrency: cfg.concurrency
    })
    if (!recheck.upToDate) {
      throw new Error(`проверка после скачивания не прошла: осталось ${recheck.toUpdate.length}`)
    }
    return { updated: checked.toUpdate.length, version: manifest.version }
  })

  ipcMain.handle('launcher:pick-dir', async () => {
    const cfg = await loadConfig()
    const win = senderWindow(getWindow())
    const options: Electron.OpenDialogOptions = {
      title: 'Выбери папку установки игры',
      defaultPath: cfg.installDir,
      properties: ['openDirectory', 'createDirectory']
    }
    const res = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (res.canceled || res.filePaths.length === 0) return null
    return res.filePaths[0] as string
  })

  ipcMain.handle('launcher:play', async () => {
    const cfg = await loadConfig()
    return playGame(cfg.installDir, cfg.exeRelPath)
  })

  // Подгон высоты окна под контент (рендерер присылает scrollHeight).
  // Ширина фиксирована, высота клампится под рабочую область экрана.
  ipcMain.handle('launcher:fit-window', async (_e, height: unknown) => {
    const win = senderWindow(getWindow())
    if (!win || typeof height !== 'number' || !Number.isFinite(height)) return
    const { height: maxH } = screen.getPrimaryDisplay().workAreaSize
    const h = Math.max(560, Math.min(Math.round(height), Math.max(560, maxH - 16)))
    win.setContentSize(700, h)
    if (!win.isVisible()) win.center()
  })
}
