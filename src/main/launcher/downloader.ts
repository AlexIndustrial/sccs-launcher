import { createHash } from 'crypto'
import { promises as fs, createWriteStream } from 'fs'
import { dirname } from 'path'
import { pipeline } from 'stream/promises'
import { Transform } from 'stream'
import { toLocalPath, type ManifestFile } from './manifest'

export interface ProgressEvent {
  phase: 'check' | 'download'
  /** 0..1 across the whole queue */
  overallRatio: number
  doneBytes: number
  totalBytes: number
  /** current file */
  filePath: string
  fileDoneBytes: number
  fileSize: number
  fileIndex: number
  fileCount: number
}

function encodeRelPath(rel: string): string {
  return rel
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/')
}

/** Downloads one file to a temporary `.tmp` and renames after hash check. */
async function downloadOne(
  serverUrl: string,
  installDir: string,
  file: ManifestFile,
  onChunk: (chunkBytes: number) => void
): Promise<void> {
  const url = `${serverUrl}/files/${encodeRelPath(file.path)}`
  const res = await fetch(url)
  if (!res.ok || !res.body) {
    throw new Error(`download failed ${file.path}: ${res.status} ${res.statusText}`)
  }

  const dest = toLocalPath(installDir, file.path)
  await fs.mkdir(dirname(dest), { recursive: true })
  const tmp = `${dest}.tmp`

  const hash = createHash('sha256')
  let written = 0
  const counter = new Transform({
    transform(chunk, _enc, cb) {
      const buf = chunk as Buffer
      written += buf.length
      hash.update(buf)
      onChunk(buf.length)
      cb(null, buf)
    }
  })

  // res.body is a Web ReadableStream; convert to Node style via async iteration
  const { Readable } = await import('stream')
  const nodeStream = Readable.fromWeb(res.body as never)

  await pipeline(nodeStream, counter, createWriteStream(tmp))

  if (written !== file.size) {
    await fs.unlink(tmp).catch(() => {})
    throw new Error(`size mismatch ${file.path}: got ${written}, want ${file.size}`)
  }
  const digest = hash.digest('hex')
  if (digest.toLowerCase() !== file.sha256.toLowerCase()) {
    await fs.unlink(tmp).catch(() => {})
    throw new Error(`sha256 mismatch ${file.path}`)
  }
  await fs.rename(tmp, dest)
  // Pin mtime from the manifest so the next check takes
  // the fast path (size + mtime) without hashing.
  if (file.mtime != null) {
    await fs.utimes(dest, file.mtime, file.mtime).catch(() => {})
  }
}

export interface DownloadOptions {
  /** How many files to download at once. Default 4. */
  concurrency?: number
  /** Minimum interval between progress events, ms. Default 100. */
  progressThrottleMs?: number
}

export async function downloadFiles(
  serverUrl: string,
  installDir: string,
  files: ManifestFile[],
  onProgress: (p: ProgressEvent) => void,
  options: DownloadOptions = {}
): Promise<void> {
  const totalBytes = files.reduce((a, f) => a + f.size, 0)
  if (files.length === 0) return

  const concurrency = clamp(Math.floor(options.concurrency ?? 4), 1, 16)
  const throttleMs = options.progressThrottleMs ?? 100

  let doneBytes = 0
  let completedFiles = 0
  let nextIndex = 0
  let failed = false
  let lastEmit = 0
  const fileDone = new Array<number>(files.length).fill(0)

  const emit = (idx: number): void => {
    const now = Date.now()
    const isLast = completedFiles === files.length
    if (!isLast && now - lastEmit < throttleMs) return
    lastEmit = now
    const f = files[idx]
    onProgress({
      phase: 'download',
      overallRatio: totalBytes === 0 ? 1 : doneBytes / totalBytes,
      doneBytes,
      totalBytes,
      filePath: f.path,
      fileDoneBytes: fileDone[idx],
      fileSize: f.size,
      fileIndex: idx + 1,
      fileCount: files.length
    })
  }

  const worker = async (): Promise<void> => {
    while (!failed) {
      const i = nextIndex++
      if (i >= files.length) return
      const f = files[i]
      try {
        await downloadOne(serverUrl, installDir, f, (chunkBytes) => {
          fileDone[i] += chunkBytes
          doneBytes += chunkBytes
          emit(i)
        })
      } catch (e) {
        failed = true
        throw e
      }
      completedFiles++
      emit(i)
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, files.length) }, () => worker())
  await Promise.all(workers)
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, n))
}
