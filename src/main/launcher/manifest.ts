import { createHash } from 'crypto'
import { promises as fs, createReadStream } from 'fs'
import { join, sep } from 'path'
import type { ProgressEvent } from './downloader'

export interface ManifestFile {
  path: string
  size: number
  sha256: string
  /** unix-секунды изменения (может отсутствовать в старых манифестах). */
  mtime?: number
}

export interface Manifest {
  version: string
  generated_at: string
  files: ManifestFile[]
}

export interface CheckResult {
  version: string
  totalFiles: number
  totalBytes: number
  toUpdate: ManifestFile[]
  toUpdateBytes: number
  upToDate: boolean
}

/** Защита от path traversal в манифесте. */
export function assertSafeRelPath(p: string): void {
  if (!p || p.includes('\\') || p.startsWith('/') || p.includes('\0')) {
    throw new Error(`unsafe path in manifest: ${p}`)
  }
  const parts = p.split('/')
  if (parts.some((seg) => seg === '' || seg === '.' || seg === '..')) {
    throw new Error(`unsafe path in manifest: ${p}`)
  }
}

export function toLocalPath(installDir: string, rel: string): string {
  assertSafeRelPath(rel)
  return join(installDir, ...rel.split('/'))
}

export async function fetchManifest(serverUrl: string): Promise<Manifest> {
  const res = await fetch(`${serverUrl}/manifest.json`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`manifest fetch failed: ${res.status} ${res.statusText}`)
  const m = (await res.json()) as Manifest
  if (!Array.isArray(m.files)) throw new Error('bad manifest: files is not an array')
  for (const f of m.files) assertSafeRelPath(f.path)
  return m
}

function hashFile(path: string, onChunk?: (bytes: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    const s = createReadStream(path)
    s.on('error', reject)
    s.on('data', (c) => {
      const buf = c as Buffer
      h.update(buf)
      onChunk?.(buf.length)
    })
    s.on('end', () => resolve(h.digest('hex')))
  })
}

export interface CheckOptions {
  /** Игнорировать mtime и хешировать всё (медленно, но точно). */
  forceHash?: boolean
  /** Сколько файлов хешировать одновременно. По умолчанию 4. */
  concurrency?: number
}

/**
 * Сравнивает локальные файлы с манифестом.
 *
 * Быстрый путь: совпали размер и mtime (секунды) — хеш не считаем.
 * Иначе файл хешируется (такие файлы проверяются параллельно пулом).
 */
export async function checkForUpdates(
  manifest: Manifest,
  installDir: string,
  onProgress?: (p: ProgressEvent) => void,
  options: CheckOptions = {}
): Promise<CheckResult> {
  const files = manifest.files
  const totalBytes = files.reduce((a, f) => a + f.size, 0)
  const concurrency = clamp(Math.floor(options.concurrency ?? 4), 1, 16)
  const forceHash = options.forceHash === true

  const toUpdate: ManifestFile[] = []
  const toHash: number[] = []
  let doneBytes = 0
  let lastEmit = 0

  const emit = (idx: number, force = false): void => {
    if (!onProgress || files.length === 0) return
    const now = Date.now()
    const isLast = force && idx === files.length - 1
    if (!force && !isLast && now - lastEmit < 100) return
    lastEmit = now
    const f = files[idx]
    onProgress({
      phase: 'check',
      overallRatio: totalBytes === 0 ? 1 : doneBytes / totalBytes,
      doneBytes,
      totalBytes,
      filePath: f.path,
      fileDoneBytes: f.size,
      fileSize: f.size,
      fileIndex: idx + 1,
      fileCount: files.length
    })
  }

  // Фаза 1: быстрый stat-проход (последовательно, это дёшево).
  for (let i = 0; i < files.length; i++) {
    const f = files[i]
    const local = toLocalPath(installDir, f.path)
    let st: { size: number; mtimeMs: number } | null = null
    try {
      const s = await fs.stat(local)
      st = { size: s.size, mtimeMs: s.mtimeMs }
    } catch {
      st = null
    }
    if (!st || st.size !== f.size) {
      toUpdate.push(f)
      doneBytes += f.size
      emit(i)
      continue
    }
    if (!forceHash && f.mtime != null && Math.floor(st.mtimeMs / 1000) === f.mtime) {
      doneBytes += f.size
      emit(i)
      continue
    }
    toHash.push(i)
  }

  // Фаза 2: хеширование кандидатов параллельно.
  // Ошибка чтения = файл битый → в очередь на скачивание, проверка продолжается.
  let next = 0
  const worker = async (): Promise<void> => {
    while (true) {
      const k = next++
      if (k >= toHash.length) return
      const i = toHash[k]
      const f = files[i]
      try {
        const digest = await hashFile(toLocalPath(installDir, f.path), (n) => {
          doneBytes += n
          emit(i)
        })
        if (digest.toLowerCase() !== f.sha256.toLowerCase()) {
          toUpdate.push(f)
        }
      } catch {
        // Не прочитался — считаем требующим скачивания.
        toUpdate.push(f)
        doneBytes += f.size
      }
      emit(i)
    }
  }
  const workers = Array.from(
    { length: Math.min(concurrency, toHash.length) },
    () => worker()
  )
  await Promise.all(workers)

  if (files.length > 0) emit(files.length - 1, true)

  // Нормализатор для Windows: путь манифеста всегда с `/`
  void sep

  const toUpdateBytes = toUpdate.reduce((a, f) => a + f.size, 0)
  return {
    version: manifest.version,
    totalFiles: files.length,
    totalBytes,
    toUpdate,
    toUpdateBytes,
    upToDate: toUpdate.length === 0
  }
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, n))
}
