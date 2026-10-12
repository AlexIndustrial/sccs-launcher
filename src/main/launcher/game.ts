import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import { toLocalPath } from './manifest'

export interface PlayResult {
  pid: number
}

/** Запускает exe игры detached-процессом. */
export async function playGame(installDir: string, exeRelPath: string): Promise<PlayResult> {
  const exe = toLocalPath(installDir, exeRelPath)
  try {
    await fs.access(exe)
  } catch {
    throw new Error(`exe не найден: ${exe}. Сначала нажми "Обновить".`)
  }

  const child = spawn(exe, [], {
    cwd: installDir,
    detached: true,
    stdio: 'ignore',
    shell: false
  })
  child.on('error', () => {})
  child.unref()
  if (!child.pid) throw new Error('не удалось запустить игру')
  return { pid: child.pid }
}
