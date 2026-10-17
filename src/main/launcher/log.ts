import { app } from 'electron'
import { appendFileSync } from 'fs'
import { join } from 'path'

/**
 * Diagnostics: renderer failures are invisible in a packaged app, so mirror
 * them into userData/launcher.log. Always failures first — that's what makes
 * a blank window debuggable on a machine we can't reach.
 */
export function logPath(): string {
  return join(app.getPath('userData'), 'launcher.log')
}

function write(kind: string, text: string): void {
  try {
    appendFileSync(logPath(), `[${new Date().toISOString()}] [${kind}] ${text}\n`, 'utf-8')
  } catch {
    // Never let logging break the app.
  }
}

export function logInfo(text: string): void {
  write('info', text)
}

export function logError(text: string): void {
  write('error', text)
}

/**
 * Wine (CrossOver/Whisky) has no working GPU stack for Electron by default:
 * the page loads fine but the window stays blank. Detect it and turn
 * hardware acceleration off before the app becomes ready.
 */
export function isWine(): boolean {
  if (process.platform !== 'win32') return false
  return (
    typeof process.env.WINELOADERNOEXEC === 'string' ||
    typeof process.env.WINEPREFIX === 'string' ||
    typeof process.env.WINEDLL_OVERRIDES === 'string'
  )
}
