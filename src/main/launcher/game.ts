import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import { toLocalPath } from './manifest'

export interface PlayResult {
  pid: number
}

/** Launches the game exe as a detached process. */
export async function playGame(installDir: string, exeRelPath: string): Promise<PlayResult> {
  const exe = toLocalPath(installDir, exeRelPath)
  try {
    await fs.access(exe)
  } catch {
    throw new Error(`exe not found: ${exe}. Press "Update" first.`)
  }

  const child = spawn(exe, [], {
    cwd: installDir,
    detached: true,
    stdio: 'ignore',
    shell: false
  })
  child.on('error', () => {})
  child.unref()
  if (!child.pid) throw new Error('failed to start the game')
  return { pid: child.pid }
}
