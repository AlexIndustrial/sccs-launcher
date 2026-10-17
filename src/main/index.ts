import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerLauncherIpc } from './launcher/ipc'
import { isWine, logError, logInfo, logPath } from './launcher/log'

// Wine can't composite our window with the GPU stack: the page loads but the
// window stays blank. Must happen before the app is ready.
const wine = isWine()
if (wine) {
  app.disableHardwareAcceleration()
  app.commandLine.appendSwitch('disable-gpu')
  app.commandLine.appendSwitch('disable-gpu-compositing')
  app.commandLine.appendSwitch('disable-software-rasterizer')
  // In-process GPU renders through Wine's GDI instead of ANGLE/D3D.
  app.commandLine.appendSwitch('in-process-gpu')
}

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  // Create the browser window.
  const win = new BrowserWindow({
    width: 700,
    height: 820,
    useContentSize: true,
    show: false,
    autoHideMenuBar: true,
    title: 'SCCS Launcher',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow = win

  win.on('ready-to-show', () => {
    win.show()
  })

  // A packaged renderer can fail silently (blank window). Log why.
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    logError(`did-fail-load code=${code} desc=${desc} url=${url}`)
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    logError(`render-process-gone: ${details.reason} exitCode=${details.exitCode}`)
  })
  win.webContents.on('preload-error', (_e, preloadPath, err) => {
    logError(`preload-error ${preloadPath}: ${err.message}`)
  })
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 2) logError(`console: ${message} (${sourceId}:${line})`)
  })
  win.webContents.on('did-finish-load', () => {
    // A blank window usually means the preload didn't expose window.api.
    win.webContents
      .executeJavaScript('typeof window.api')
      .then((t) => {
        logInfo(`renderer loaded, window.api=${String(t)}`)
        if (wine) {
          logInfo('gpu: disabled by wine workaround')
          // Compositing CSS effects break the blank window on Wine.
          win.webContents
            .executeJavaScript("document.documentElement.classList.add('sc-no-compositing')")
            .catch(() => {})
        }
      })
      .catch((e: Error) => logError(`cannot read window.api: ${e.message}`))
    // Did React actually paint something? A blank window with a rendered
    // DOM is a compositing problem; an empty #root is a React problem.
    setTimeout(() => {
      win.webContents
        .executeJavaScript(
          "(() => { const r = document.getElementById('root'); return r ? r.childElementCount + ':' + r.textContent.length : 'no-root'; })()"
        )
        .then((t) => logInfo(`root content: ${String(t)}`))
        .catch((e: Error) => logError(`cannot read root: ${e.message}`))
    }, 3000)
  })

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.sccs.launcher')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  logInfo(`launcher start, version=${app.getVersion()}, wine=${wine}, log=${logPath()}`)

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))
  registerLauncherIpc(() => mainWindow)

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
