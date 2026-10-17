export type Lang = 'ru' | 'en'

const LANG_KEY = 'sccs-lang'

export function loadLang(): Lang {
  try {
    return window.localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'ru'
  } catch {
    return 'ru'
  }
}

export function saveLang(lang: Lang): void {
  try {
    window.localStorage.setItem(LANG_KEY, lang)
  } catch {
    // ignore
  }
}

interface Strings {
  play: string
  check: string
  fullCheck: string
  fullCheckHint: string
  update: string
  settings: string
  server: string
  customServer: string
  customServerPh: string
  installDir: string
  choose: string
  threads: string
  add: string
  remove: string
  removeMainHint: string
  removeHint: string
  mainTag: string
  checking: string
  downloading: string
  trustWarnHint: string
  trustWarnConfirm: string
  footerBy: string
  appUpdate: string
  appUpdateCheck: string
  appUpdateChecking: string
  appUpdateUpToDate: string
  appUpdateAvailable: string
  appUpdateDownloading: string
  appUpdateReady: string
  appUpdateFailed: string
  appUpdateInstall: string
  appUpdateDevNote: string
}

const ru: Strings = {
  play: 'Играть',
  check: 'Проверить',
  fullCheck: 'Полная проверка',
  fullCheckHint: 'Игнорировать время изменения, пересчитать хеши всех файлов',
  update: 'Обновить',
  settings: 'Настройки',
  server: 'Сервер',
  customServer: 'Свой сервер',
  customServerPh: 'https://…',
  installDir: 'Папка установки',
  choose: 'Выбрать…',
  threads: 'Потоки загрузки',
  add: 'Добавить',
  remove: 'Убрать',
  removeMainHint: 'Его убрать нельзя',
  removeHint: 'Убрать сервер из списка',
  mainTag: '(основной)',
  checking: 'Проверка',
  downloading: 'Скачивание',
  trustWarnHint:
    'Добавляй только серверы, которым доверяешь: игра скачивается с выбранного сервера, чужой сервер может подсунуть вредоносное ПО.',
  trustWarnConfirm:
    'Добавляешь сторонний сервер. Скачивай игру только с серверов, которым доверяешь — иначе можно загрузить вредоносное ПО.\n\nПродолжить?',
  footerBy: 'build by',
  appUpdate: 'Программа',
  appUpdateCheck: 'Проверить обновление',
  appUpdateChecking: 'Проверка обновлений…',
  appUpdateUpToDate: 'Установлена последняя версия',
  appUpdateAvailable: 'Доступно обновление',
  appUpdateDownloading: 'Загрузка обновления…',
  appUpdateReady: 'Обновление готово к установке',
  appUpdateFailed: 'Ошибка обновления',
  appUpdateInstall: 'Установить и перезапустить',
  appUpdateDevNote: 'В dev-режиме автообновление недоступно'
}

const en: Strings = {
  play: 'Play',
  check: 'Check',
  fullCheck: 'Full check',
  fullCheckHint: 'Ignore modification times, re-hash every file',
  update: 'Update',
  settings: 'Settings',
  server: 'Server',
  customServer: 'Custom server',
  customServerPh: 'https://…',
  installDir: 'Install folder',
  choose: 'Browse…',
  threads: 'Download threads',
  add: 'Add',
  remove: 'Remove',
  removeMainHint: 'It cannot be removed',
  removeHint: 'Remove server from the list',
  mainTag: '(main)',
  checking: 'Checking',
  downloading: 'Downloading',
  trustWarnHint:
    'Only add servers you trust: the game is downloaded from the selected server, a stranger server could serve malware.',
  trustWarnConfirm:
    'You are adding a third-party server. Only download the game from servers you trust — otherwise you may get malware.\n\nContinue?',
  footerBy: 'build by',
  appUpdate: 'App',
  appUpdateCheck: 'Check for update',
  appUpdateChecking: 'Checking for updates…',
  appUpdateUpToDate: 'Latest version installed',
  appUpdateAvailable: 'Update available',
  appUpdateDownloading: 'Downloading update…',
  appUpdateReady: 'Update ready to install',
  appUpdateFailed: 'Update error',
  appUpdateInstall: 'Install and restart',
  appUpdateDevNote: 'Auto-update is unavailable in dev mode'
}

export function strs(lang: Lang): Strings {
  return lang === 'en' ? en : ru
}

// ---- dynamic statuses and log lines ----

export const stLoading = (l: Lang): string => (l === 'en' ? 'Loading config…' : 'Загрузка конфига…')

export const stReady = (l: Lang): string =>
  l === 'en' ? 'Ready. Press "Check".' : 'Готов. Нажми «Проверить».'

export const stConfigError = (l: Lang, e: unknown): string =>
  l === 'en' ? `Config error: ${String(e)}` : `Ошибка конфига: ${String(e)}`

export const stChecking = (l: Lang, full: boolean): string =>
  full
    ? l === 'en'
      ? 'Full check (hashing)…'
      : 'Полная проверка (хеширование)…'
    : l === 'en'
      ? 'Checking for updates…'
      : 'Проверка обновлений…'

export const stUpToDate = (l: Lang, version: string, total: number): string =>
  l === 'en'
    ? `Up to date (v${version}, files: ${total})`
    : `Актуально (v${version}, файлов: ${total})`

export const stNeed = (l: Lang, count: number, bytes: string, total: number): string =>
  l === 'en'
    ? `Need to download ${count} files (${bytes}) of ${total}`
    : `Нужно скачать ${count} файлов (${bytes}) из ${total}`

export const stCheckError = (l: Lang, e: unknown): string =>
  l === 'en' ? `Check error: ${String(e)}` : `Ошибка проверки: ${String(e)}`

export const stDownloading = (l: Lang): string => (l === 'en' ? 'Downloading…' : 'Скачивание…')

export const stUpdated = (l: Lang, updated: number, version: string): string =>
  l === 'en'
    ? `Updated ${updated} files (v${version}). Ready to play.`
    : `Обновлено файлов: ${updated} (v${version}). Можно играть.`

export const stUpdateError = (l: Lang, e: unknown): string =>
  l === 'en' ? `Update error: ${String(e)}` : `Ошибка обновления: ${String(e)}`

export const stPlayed = (l: Lang, pid: number): string =>
  l === 'en' ? `Game started (pid ${pid})` : `Игра запущена (pid ${pid})`

export const stPlayError = (l: Lang, e: unknown): string =>
  l === 'en' ? `Failed to start: ${String(e)}` : `Не запустилась: ${String(e)}`

export const logSaved = (l: Lang): string => (l === 'en' ? 'Settings saved' : 'Настройки сохранены')

export const logDir = (l: Lang, dir: string): string =>
  l === 'en' ? `install folder: ${dir}` : `папка установки: ${dir}`

export const logPickDirError = (l: Lang, e: unknown): string =>
  l === 'en' ? `pick dir error: ${String(e)}` : `pick dir error: ${String(e)}`

export const logServerAdded = (l: Lang, url: string): string =>
  l === 'en' ? `server added: ${url}` : `сервер добавлен: ${url}`

export const logServerRemoved = (l: Lang, url: string): string =>
  l === 'en' ? `server removed, selected: ${url}` : `сервер убран, выбран: ${url}`

export const logNeed = (l: Lang, count: number, bytes: string): string =>
  l === 'en' ? `check: ${count} to update, ${bytes}` : `check: надо обновить ${count}, ${bytes}`

export const logUpdated = (l: Lang, updated: number, version: string): string =>
  l === 'en'
    ? `update: ok, ${updated} files, v${version}`
    : `update: ok, ${updated} файлов, v${version}`
