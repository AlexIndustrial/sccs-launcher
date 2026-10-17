import { app } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'

/** The main server — always first in the list, cannot be removed. */
export const DEFAULT_SERVER = 'https://cdn.sccs.dsrt.app'

export interface LauncherConfig {
  /** Selected server (always one of `servers`). */
  serverUrl: string
  /** Full list for the UI: [DEFAULT_SERVER, ...custom ones]. */
  servers: string[]
  installDir: string
  exeRelPath: string
  /** How many files to download at once (1..16). */
  concurrency: number
}

function defaultConfig(): LauncherConfig {
  return {
    serverUrl: DEFAULT_SERVER,
    servers: [DEFAULT_SERVER],
    installDir: join(app.getPath('userData'), 'game'),
    exeRelPath: 'win64/game.exe',
    concurrency: 4
  }
}

function configPath(): string {
  return join(app.getPath('userData'), 'launcher-config.json')
}

function normalizeServer(u: unknown): string | null {
  if (typeof u !== 'string') return null
  const t = u.trim().replace(/\/+$/, '')
  if (!t || !/^https?:\/\//i.test(t)) return null
  return t
}

/** Cleans the custom list: trim, http(s) only, no default, no dupes. */
function cleanCustomServers(list: unknown): string[] {
  if (!Array.isArray(list)) return []
  const out: string[] = []
  for (const item of list) {
    const n = normalizeServer(item)
    if (n && n !== DEFAULT_SERVER && !out.includes(n)) out.push(n)
  }
  return out
}

export async function loadConfig(): Promise<LauncherConfig> {
  const defaults = defaultConfig()
  try {
    const raw = await fs.readFile(configPath(), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<LauncherConfig> & { servers?: unknown }
    // Migrate legacy configs: adopt the selected custom server into the list.
    const customsRaw =
      parsed.servers ??
      (parsed.serverUrl && parsed.serverUrl !== DEFAULT_SERVER ? [parsed.serverUrl] : [])
    const customs = cleanCustomServers(customsRaw)
    const servers = [DEFAULT_SERVER, ...customs]
    const serverUrl = normalizeServer(parsed.serverUrl)
    const merged: LauncherConfig = {
      ...defaults,
      ...parsed,
      servers,
      serverUrl: serverUrl && servers.includes(serverUrl) ? serverUrl : DEFAULT_SERVER
    }
    merged.concurrency = clampConcurrency(merged.concurrency)
    return merged
  } catch {
    return defaults
  }
}

export async function saveConfig(patch: Partial<LauncherConfig>): Promise<LauncherConfig> {
  const current = await loadConfig()
  const customs = cleanCustomServers(
    patch.servers ?? current.servers.filter((s) => s !== DEFAULT_SERVER)
  )
  const servers = [DEFAULT_SERVER, ...customs]
  let serverUrl = normalizeServer(patch.serverUrl ?? current.serverUrl) ?? DEFAULT_SERVER
  if (!servers.includes(serverUrl)) {
    // The selected server was removed from the list (or is broken) — fall back.
    serverUrl = servers.includes(current.serverUrl) ? current.serverUrl : DEFAULT_SERVER
  }
  const next: LauncherConfig = {
    ...current,
    ...patch,
    servers,
    serverUrl,
    concurrency: clampConcurrency(patch.concurrency ?? current.concurrency)
  }
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  await fs.writeFile(configPath(), JSON.stringify(next, null, 2), 'utf-8')
  return next
}

function clampConcurrency(n: unknown): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.floor(n) : 4
  return Math.min(16, Math.max(1, v))
}
