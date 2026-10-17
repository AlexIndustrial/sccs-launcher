import { createHash } from 'crypto'
import { promises as fs, createReadStream } from 'fs'
import { join, sep } from 'path'
import type { ProgressEvent } from './downloader'

export interface ManifestFile {
  path: string
  size: number
  sha256: string
  /** unix seconds of modification (may be absent in old manifests). */
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
  /** Files accepted by size+mtime without hashing. */
  fastMatched: number
  /** Files that had to be hashed. */
  hashed: number
  /** Total bytes actually hashed (0 when everything matched fast). */
  hashedBytes: number
  /** Files whose mtime was repaired after a successful hash match. */
  repaired: number
}

/** Path traversal protection for manifest entries. */
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** Hashing more than a few files at once starves the disk queue and freezes Windows. */
const MAX_HASH_WORKERS = 4
/** How often the I/O sampler measures throughput. */
const IO_POLL_MS = 1000
/** Ignore the first interval: it is dominated by stream startup cost. */
const IO_WARMUP_MS = 1500
/** Keep aggregate reads under this fraction of what the disk actually delivers. */
const THROTTLE_RATIO = 0.85
/** Below this fraction of the best rate we assume seek thrash and back off. */
const LOSS_RATIO = 0.55
/** Above this fraction we allow another worker. */
const GAIN_RATIO = 0.9
const BACKOFF_COOLDOWN_MS = 1500
const RAMP_COOLDOWN_MS = 3000
/** Never sleep longer than this in one go, so cancellation stays responsive. */
const MAX_PACE_SLEEP_MS = 1000

/**
 * Paces aggregate reads just below what the disk actually sustains, so the
 * request queue never backs up and the rest of the system stays responsive.
 * The target is learned at runtime by {@link IoSampler}.
 */
class Pacer {
  private readonly startedAt = Date.now()
  private consumed = 0
  private targetBytesPerSec = 0

  setTarget(bytesPerSec: number): void {
    this.targetBytesPerSec = bytesPerSec
  }

  async take(bytes: number): Promise<void> {
    this.consumed += bytes
    if (this.targetBytesPerSec <= 0) return
    const owedMs = (this.consumed / this.targetBytesPerSec) * 1000 - (Date.now() - this.startedAt)
    if (owedMs > 1) await sleep(Math.min(owedMs, MAX_PACE_SLEEP_MS))
  }
}

export interface WorkerDecision {
  workers: number
  cooldownUntil: number
}

/**
 * Pure policy for the I/O sampler, kept separate so it can be tested without
 * moving gigabytes.
 *
 * `rate` well below `bestRate` while several streams are open is the signature
 * of seek thrash: back off. A rate at or above `bestRate` means the disk is
 * keeping up, so one more stream may be allowed.
 */
export function decideWorkerCount(
  workers: number,
  rate: number,
  bestRate: number,
  maxWorkers: number,
  now: number,
  cooldownUntil: number
): WorkerDecision | null {
  if (bestRate <= 0 || rate <= 0) return null
  if (now < cooldownUntil) return null
  if (workers > 1 && rate < bestRate * LOSS_RATIO) {
    return { workers: workers - 1, cooldownUntil: now + BACKOFF_COOLDOWN_MS }
  }
  if (workers < maxWorkers && rate > bestRate * GAIN_RATIO) {
    return { workers: workers + 1, cooldownUntil: now + RAMP_COOLDOWN_MS }
  }
  return null
}

/**
 * Polls hashing throughput and adapts the worker count.
 *
 * A drop in aggregate throughput while more workers are active is the
 * signature of seek thrash on spinning disks: fewer streams restore both
 * speed and desktop responsiveness.
 */
class IoSampler {
  private timer: NodeJS.Timeout | null = null
  private lastBytes = 0
  private lastAt = 0
  private startedAt = 0
  private bestRate = 0
  private seeded = false
  private cooldownUntil = 0
  private readonly workers: () => number
  private readonly maxWorkers: number
  private readonly setWorkers: (n: number) => void
  private readonly pacer: Pacer
  private readonly readCounter: () => number

  constructor(
    workers: () => number,
    maxWorkers: number,
    setWorkers: (n: number) => void,
    pacer: Pacer,
    readCounter: () => number
  ) {
    this.workers = workers
    this.maxWorkers = maxWorkers
    this.setWorkers = setWorkers
    this.pacer = pacer
    this.readCounter = readCounter
  }

  start(): void {
    this.lastAt = Date.now()
    this.startedAt = this.lastAt
    this.timer = setInterval(() => this.poll(), IO_POLL_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private poll(): void {
    const now = Date.now()
    const dtSec = (now - this.lastAt) / 1000
    const bytes = this.readCounter()
    const rate = dtSec > 0 ? (bytes - this.lastBytes) / dtSec : 0
    this.lastBytes = bytes
    this.lastAt = now

    if (now - this.startedAt < IO_WARMUP_MS) return

    // Seed from the first settled sample: warmup reads are served from the
    // page cache and would inflate the ceiling, disabling the throttle.
    if (!this.seeded) {
      this.seeded = true
      this.bestRate = rate
    } else if (rate > this.bestRate) {
      this.bestRate = rate
    }
    if (this.bestRate <= 0 || rate <= 0) return

    // Hold reads just under the sustained rate: this, not the worker count, is
    // what keeps the disk request queue from backing up and stalling Windows.
    this.pacer.setTarget(this.bestRate * THROTTLE_RATIO)

    const decision = decideWorkerCount(
      this.workers(),
      rate,
      this.bestRate,
      this.maxWorkers,
      now,
      this.cooldownUntil
    )
    if (!decision) return
    this.setWorkers(decision.workers)
    this.cooldownUntil = decision.cooldownUntil
  }
}

async function hashFile(
  path: string,
  onChunk?: (bytes: number) => void,
  pacer?: Pacer
): Promise<string> {
  const h = createHash('sha256')
  const s = createReadStream(path, { highWaterMark: 512 * 1024 })
  try {
    for await (const chunk of s) {
      const buf = chunk as Buffer
      h.update(buf)
      onChunk?.(buf.length)
      if (pacer) await pacer.take(buf.length)
    }
  } finally {
    s.destroy()
  }
  return h.digest('hex')
}

export interface CheckOptions {
  /** Ignore mtime and hash everything (slow but exact). */
  forceHash?: boolean
  /** How many files to hash at once. Default 4. */
  concurrency?: number
}

/**
 * Compares local files against the manifest.
 *
 * Fast path: size and mtime (seconds) match — no hashing.
 * The rest is hashed in parallel by a worker pool.
 */
export async function checkForUpdates(
  manifest: Manifest,
  installDir: string,
  onProgress?: (p: ProgressEvent) => void,
  options: CheckOptions = {}
): Promise<CheckResult> {
  const files = manifest.files
  const totalBytes = files.reduce((a, f) => a + f.size, 0)
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

  // Phase 1: cheap sequential stat pass.
  let fastMatched = 0
  let hashedBytes = 0
  // Files whose timestamp drifted: if their hash matches we can repair mtime.
  const stMismatch = new Set<number>()
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
      fastMatched++
      doneBytes += f.size
      emit(i)
      continue
    }
    toHash.push(i)
    // Under forceHash we hash everything on purpose; nothing to repair.
    if (!forceHash) stMismatch.add(i)
  }

  // Phase 2: hash the candidates with a worker pool that shrinks when the disk
  // starts thrashing. A read error means the file is broken → queue for
  // download, keep checking.
  const capWorkers = clamp(Math.floor(options.concurrency ?? 4), 1, MAX_HASH_WORKERS)
  const pacer = new Pacer()
  let next = 0
  let running = 0
  let desired = Math.min(capWorkers, Math.max(1, toHash.length))
  let repaired = 0
  const active = new Set<Promise<void>>()

  const pump = (): void => {
    while (running < desired && next < toHash.length) {
      running++
      const p: Promise<void> = worker().finally(() => {
        active.delete(p)
      })
      active.add(p)
    }
  }

  const worker = async (): Promise<void> => {
    while (next < toHash.length && running <= desired) {
      const k = next++
      const i = toHash[k]
      const f = files[i]
      let fileDone = 0
      try {
        const localPath = toLocalPath(installDir, f.path)
        const digest = await hashFile(
          localPath,
          (n) => {
            fileDone += n
            hashedBytes += n
            doneBytes += n
            emit(i)
          },
          pacer
        )
        if (digest.toLowerCase() !== f.sha256.toLowerCase()) {
          toUpdate.push(f)
        } else if (f.mtime != null && stMismatch.has(i)) {
          // Content is correct but the timestamp drifted (file predates the
          // mtime-pinning code, or the filesystem moved it). Repair it so the
          // next check takes the fast path instead of re-hashing forever.
          try {
            await fs.utimes(localPath, f.mtime, f.mtime)
            repaired++
          } catch {
            // Filesystem refused: file stays on the hash path next time.
          }
        }
      } catch {
        // Unreadable — treat as needing download. Only the unread tail is
        // still outstanding; the chunks already counted must not double up.
        toUpdate.push(f)
        doneBytes += Math.max(0, f.size - fileDone)
      }
      emit(i)
    }
    running--
    pump()
  }

  const sampler = new IoSampler(
    () => desired,
    capWorkers,
    (n) => {
      desired = clamp(n, 1, capWorkers)
    },
    pacer,
    () => hashedBytes
  )
  sampler.start()
  pump()
  while (active.size > 0) await Promise.race(active)
  sampler.stop()

  if (files.length > 0) emit(files.length - 1, true)

  // Normalizer for Windows: manifest paths always use `/`
  void sep

  const toUpdateBytes = toUpdate.reduce((a, f) => a + f.size, 0)
  return {
    version: manifest.version,
    totalFiles: files.length,
    totalBytes,
    toUpdate,
    toUpdateBytes,
    upToDate: toUpdate.length === 0,
    fastMatched,
    hashed: toHash.length,
    hashedBytes,
    repaired
  }
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, n))
}
