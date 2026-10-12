import { useEffect, useState } from 'react'
import logoUrl from './assets/sc/logo.png'
import {
  loadLang,
  saveLang,
  strs,
  stLoading,
  stReady,
  stConfigError,
  stChecking,
  stUpToDate,
  stNeed,
  stCheckError,
  stDownloading,
  stUpdated,
  stUpdateError,
  stPlayed,
  stPlayError,
  logSaved,
  logDir,
  logPickDirError,
  logServerAdded,
  logServerRemoved,
  type Lang
} from './i18n'

interface Progress {
  phase: 'check' | 'download'
  overallRatio: number
  doneBytes: number
  totalBytes: number
  filePath: string
  fileDoneBytes: number
  fileSize: number
  fileIndex: number
  fileCount: number
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function LangSwitch({
  lang,
  onChange,
  disabled
}: {
  lang: Lang
  onChange: (l: Lang) => void
  disabled: boolean
}): React.JSX.Element {
  const btn = (active: boolean): string => `sc-lang-btn${active ? ' is-active' : ''}`
  return (
    <div className="sc-lang" role="group" aria-label="Language">
      <button
        type="button"
        className={btn(lang === 'ru')}
        disabled={disabled}
        onClick={() => onChange('ru')}
      >
        RU
      </button>
      <button
        type="button"
        className={btn(lang === 'en')}
        disabled={disabled}
        onClick={() => onChange('en')}
      >
        EN
      </button>
    </div>
  )
}

function GithubIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  )
}

function App(): React.JSX.Element {
  const [lang] = useState<Lang>(() => loadLang())
  const [serverUrl, setServerUrl] = useState(window.api.defaultServer)
  const [servers, setServers] = useState<string[]>([])
  const [newServer, setNewServer] = useState('')
  const [installDir, setInstallDir] = useState('')
  const [exeRelPath, setExeRelPath] = useState('win64/game.exe')
  const [concurrency, setConcurrency] = useState(4)
  const [status, setStatus] = useState(() => stLoading(loadLang()))
  const [log, setLog] = useState<string[]>([])
  const [progress, setProgress] = useState<Progress | null>(null)
  const [busy, setBusy] = useState(false)
  const [canPlay, setCanPlay] = useState(false)

  const S = strs(lang)

  const changeLang = (l: Lang): void => {
    if (l === lang || busy) return
    saveLang(l)
    // Полная перезагрузка, чтобы точно всё обновилось.
    window.location.reload()
  }

  const pushLog = (line: string): void => {
    const ts = new Date().toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    })
    setLog((prev) => [...prev.slice(-200), `${ts}  ${line}`])
  }

  useEffect(() => {
    window.api
      .getConfig()
      .then((cfg) => {
        setServerUrl(cfg.serverUrl)
        setServers(cfg.servers)
        setInstallDir(cfg.installDir)
        setExeRelPath(cfg.exeRelPath)
        setConcurrency(cfg.concurrency)
        setStatus(stReady(loadLang()))
      })
      .catch((e) => setStatus(stConfigError(loadLang(), e)))

    const off = window.api.onProgress((p) => setProgress(p))
    return off
  }, [])

  // Подгон высоты окна под контент: после монтирования и при смене языка
  // (шрифты/картинки могут догрузиться позже — повторяем замер).
  useEffect(() => {
    let cancelled = false
    const fit = (): void => {
      if (cancelled) return
      window.api.fitWindow(document.documentElement.scrollHeight).catch(() => {})
    }
    const t1 = setTimeout(fit, 60)
    const t2 = setTimeout(fit, 600)
    if (document.fonts?.ready) {
      document.fonts.ready.then(() => setTimeout(fit, 50)).catch(() => {})
    }
    window.addEventListener('load', fit)
    return () => {
      cancelled = true
      clearTimeout(t1)
      clearTimeout(t2)
      window.removeEventListener('load', fit)
    }
  }, [lang])

  const hasProgress = progress !== null
  // Прогресс появился после стартового замера — подрасти под него.
  // Обратное схлопывание не делаем, чтобы окно не дёргалось.
  useEffect(() => {
    if (!hasProgress) return
    const t = setTimeout(() => {
      window.api.fitWindow(document.documentElement.scrollHeight).catch(() => {})
    }, 80)
    return () => clearTimeout(t)
  }, [hasProgress])

  const applyCfg = (cfg: {
    serverUrl: string
    servers: string[]
    installDir: string
    exeRelPath: string
    concurrency: number
  }): void => {
    setServerUrl(cfg.serverUrl)
    setServers(cfg.servers)
    setInstallDir(cfg.installDir)
    setExeRelPath(cfg.exeRelPath)
    setConcurrency(cfg.concurrency)
  }

  const saveSettings = async (): Promise<void> => {
    const cfg = await window.api.setConfig({
      serverUrl,
      servers,
      installDir,
      exeRelPath,
      concurrency
    })
    applyCfg(cfg)
    pushLog(logSaved(lang))
  }

  const handleSelectServer = (url: string): void => {
    window.api.setConfig({ serverUrl: url }).then(applyCfg)
  }

  const handleAddServer = (): void => {
    const v = newServer.trim()
    if (!v) return
    if (!window.confirm(S.trustWarnConfirm)) return
    window.api.setConfig({ servers: [...servers, v], serverUrl: v }).then((cfg) => {
      applyCfg(cfg)
      setNewServer('')
      pushLog(logServerAdded(lang, cfg.serverUrl))
    })
  }

  const handleRemoveServer = (): void => {
    if (serverUrl === window.api.defaultServer) return
    window.api.setConfig({ servers: servers.filter((s) => s !== serverUrl) }).then((cfg) => {
      applyCfg(cfg)
      pushLog(logServerRemoved(lang, cfg.serverUrl))
    })
  }

  const handleCheck = (full: boolean) => async (): Promise<void> => {
    setBusy(true)
    setProgress(null)
    try {
      await saveSettings()
      setStatus(stChecking(lang, full))
      const r = await window.api.check(full)
      if (r.upToDate) {
        setStatus(stUpToDate(lang, r.version, r.totalFiles))
        pushLog(`check: up-to-date v${r.version}`)
        setCanPlay(true)
      } else {
        setStatus(stNeed(lang, r.toUpdate.length, fmtBytes(r.toUpdateBytes), r.totalFiles))
        pushLog(`check: надо обновить ${r.toUpdate.length}, ${fmtBytes(r.toUpdateBytes)}`)
        setCanPlay(false)
      }
    } catch (e) {
      setStatus(stCheckError(lang, e))
      pushLog(`check error: ${String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const handleUpdate = async (): Promise<void> => {
    setBusy(true)
    setProgress(null)
    try {
      await saveSettings()
      setStatus(stDownloading(lang))
      const r = await window.api.update()
      setStatus(stUpdated(lang, r.updated, r.version))
      pushLog(`update: ok, ${r.updated} файлов, v${r.version}`)
      setCanPlay(true)
    } catch (e) {
      setStatus(stUpdateError(lang, e))
      pushLog(`update error: ${String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const handlePlay = async (): Promise<void> => {
    try {
      const r = await window.api.play()
      setStatus(stPlayed(lang, r.pid))
      pushLog(`play: pid ${r.pid}`)
    } catch (e) {
      setStatus(stPlayError(lang, e))
      pushLog(`play error: ${String(e)}`)
    }
  }

  const handlePickDir = async (): Promise<void> => {
    try {
      const dir = await window.api.pickDir()
      if (dir) {
        setInstallDir(dir)
        pushLog(logDir(lang, dir))
      }
    } catch (e) {
      pushLog(logPickDirError(lang, e))
    }
  }

  const pct = progress ? Math.round(progress.overallRatio * 100) : 0
  const phaseLabel = progress?.phase === 'check' ? S.checking : S.downloading
  const progressText = progress
    ? `${phaseLabel} ${pct}% — ${progress.fileIndex}/${progress.fileCount} ${progress.filePath} (${fmtBytes(progress.doneBytes)}/${fmtBytes(progress.totalBytes)})`
    : ''
  const isDefaultServer = serverUrl === window.api.defaultServer

  return (
    <div>
      <header className="sc-hero">
        <div className="sc-hero-top">
          <LangSwitch lang={lang} onChange={changeLang} disabled={busy} />
        </div>
        <img src={logoUrl} alt="Star Conflict" className="sc-logo" />
        <p className="sc-kicker">Community Server • Launcher</p>
        <div>
          <span className={`sc-pill${busy ? ' is-busy' : ''}`} title={status}>
            <span className="dot" />
            <span className="sc-pill-txt">{status}</span>
          </span>
        </div>
      </header>

      <div className="sc-body">
        <section className="sc-card">
          <div style={{ display: 'grid', gap: 10 }}>
            <button className="sc-btn sc-btn-play" disabled={!canPlay || busy} onClick={handlePlay}>
              {S.play}
            </button>
            <div className="sc-btn-row">
              <button className="sc-btn sc-btn-ghost" disabled={busy} onClick={handleCheck(false)}>
                {S.check}
              </button>
              <button
                className="sc-btn sc-btn-ghost"
                disabled={busy}
                onClick={handleCheck(true)}
                title={S.fullCheckHint}
              >
                {S.fullCheck}
              </button>
              <button className="sc-btn sc-btn-ghost" disabled={busy} onClick={handleUpdate}>
                {S.update}
              </button>
            </div>
          </div>

          {/* Без резерва места: при появлении прогресса окно подрастает (см. эффект ниже) */}
          {progress && (
            <div className="sc-progress-wrap">
              <div className="sc-progress-track">
                <div className="sc-progress-fill" style={{ width: `${pct}%` }} />
              </div>
              <div className="sc-progress-label" title={progressText}>
                {progressText}
              </div>
            </div>
          )}
        </section>

        <section className="sc-card">
          <h2>{S.settings}</h2>
          <label className="sc-field">
            {S.server}
            <span className="sc-dir-row">
              <select
                className="sc-input"
                value={serverUrl}
                onChange={(e) => handleSelectServer(e.target.value)}
              >
                {servers.map((s) => (
                  <option key={s} value={s}>
                    {s}
                    {s === window.api.defaultServer ? ` ${S.mainTag}` : ''}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="sc-btn sc-btn-small"
                disabled={isDefaultServer}
                title={isDefaultServer ? S.removeMainHint : S.removeHint}
                onClick={handleRemoveServer}
              >
                {S.remove}
              </button>
            </span>
          </label>
          <label className="sc-field">
            {S.customServer}
            <span className="sc-dir-row">
              <input
                className="sc-input"
                value={newServer}
                placeholder={S.customServerPh}
                onChange={(e) => setNewServer(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddServer()
                }}
              />
              <button type="button" className="sc-btn sc-btn-small" onClick={handleAddServer}>
                {S.add}
              </button>
            </span>
          </label>
          <p className="sc-warn">⚠️ {S.trustWarnHint}</p>
          <label className="sc-field">
            {S.installDir}
            <span className="sc-dir-row">
              <input
                className="sc-input"
                value={installDir}
                onChange={(e) => setInstallDir(e.target.value)}
              />
              <button type="button" className="sc-btn sc-btn-small" onClick={handlePickDir}>
                {S.choose}
              </button>
            </span>
          </label>
          <label className="sc-field">
            {S.threads}: <span className="sc-range-value">{concurrency}</span>
            <input
              type="range"
              className="sc-range"
              min={1}
              max={16}
              step={1}
              value={concurrency}
              onChange={(e) => setConcurrency(Number(e.target.value))}
            />
          </label>
        </section>

        <pre className="sc-log">{log.join('\n')}</pre>

        <footer className="sc-sign">
          <span>
            {S.footerBy} AlexIndustrial with <span className="sc-heart">❤️</span>
          </span>
          <a
            href="https://github.com/AlexIndustrial/sccs-launcher"
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub"
            title="GitHub"
          >
            <GithubIcon />
          </a>
        </footer>
      </div>
    </div>
  )
}

export default App
