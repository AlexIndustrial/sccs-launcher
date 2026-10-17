import { app, dialog, ipcMain, screen, type BrowserWindow } from 'electron'
import { loadConfig, saveConfig } from './config'
import { checkForUpdates, fetchManifest } from './manifest'
import { downloadFiles, type ProgressEvent } from './downloader'
import { playGame } from './game'
import { checkForAppUpdate, setupAutoUpdater } from './updater'

function senderWindow(win: BrowserWindow | null): BrowserWindow | null {
  return win
}

/** Registers launcher IPC. `getWindow` is used to push progress events. */
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
      concurrency: cfg.concurrency,
      onMtimeFail: (path, err) => {
        win?.webContents.send('launcher:warning', {
          scope: 'mtime',
          path,
          message: String(err)
        })
      }
    })

    // final re-check
    const recheck = await checkForUpdates(manifest, cfg.installDir, onProgress, {
      concurrency: cfg.concurrency
    })
    if (!recheck.upToDate) {
      throw new Error(`post-download verification failed: ${recheck.toUpdate.length} left`)
    }
    return { updated: checked.toUpdate.length, version: manifest.version }
  })

  ipcMain.handle('launcher:pick-dir', async () => {
    const cfg = await loadConfig()
    const win = senderWindow(getWindow())
    const options: Electron.OpenDialogOptions = {
      title: 'Choose the game install folder',
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

  ipcMain.handle('launcher:update-check', async () => {
    return checkForAppUpdate()
  })

  // App updates are checked in the background and offered via a native dialog;
  // only the download progress is mirrored to the renderer for the status pill.
  setupAutoUpdater(
    () => senderWindow(getWindow()),
    () => (app.getLocale().toLowerCase().startsWith('ru') ? 'ru' : 'en')
  )

  // Fit window height to content (renderer sends scrollHeight).
  // Width is fixed, height is clamped to the screen work area.
  ipcMain.handle('launcher:fit-window', async (_e, height: unknown) => {
    const win = senderWindow(getWindow())
    if (!win || typeof height !== 'number' || !Number.isFinite(height)) return
    const { height: maxH } = screen.getPrimaryDisplay().workAreaSize
    const h = Math.max(560, Math.min(Math.round(height), Math.max(560, maxH - 16)))
    win.setContentSize(700, h)
    if (!win.isVisible()) win.center()
  })
}
