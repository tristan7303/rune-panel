/**
 * Updates, from GitHub Releases.
 *
 * Deliberately never automatic. `autoDownload` and `autoInstallOnAppQuit` are
 * both off, so nothing is fetched or applied until the user says so — this app
 * sits over a game, and an update that restarts it mid-raid because it felt
 * like it is worse than one that waits.
 *
 * The check itself is unauthenticated, which is why the repository has to be
 * public: against a private repo GitHub answers 404 and the updater reports
 * "no updates available" forever, with no error to notice.
 */

import { app } from 'electron'
import electronUpdater from 'electron-updater'
import type { UpdateStatus } from '../shared/ipc'

const { autoUpdater } = electronUpdater

/** Wait before the first check so it never competes with startup. */
const FIRST_CHECK_DELAY_MS = 20_000
/** And once a day after that, for a session left running. */
const RECHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

let status: UpdateStatus = {
  state: 'idle',
  version: null,
  currentVersion: app.getVersion(),
  progress: 0,
}
type Listener = (status: UpdateStatus) => void
const listeners = new Set<Listener>()

export function onStatus(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getStatus(): UpdateStatus {
  return { ...status }
}

function set(next: Partial<UpdateStatus>): void {
  status = { ...status, ...next }
  for (const listener of listeners) listener(getStatus())
}

export function init(): void {
  // In development there is no packaged app to replace, and the updater throws
  // rather than no-ops if asked.
  if (!app.isPackaged) {
    set({ state: 'unsupported', message: 'Updates are only checked in an installed build.' })
    return
  }

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.logger = null

  autoUpdater.on('checking-for-update', () => set({ state: 'checking', message: undefined }))

  autoUpdater.on('update-available', (info) => {
    set({ state: 'available', version: info.version, progress: 0 })
  })

  autoUpdater.on('update-not-available', () => set({ state: 'current', version: null }))

  autoUpdater.on('download-progress', (p) => {
    set({ state: 'downloading', progress: Math.round(p.percent) })
  })

  autoUpdater.on('update-downloaded', (info) => {
    set({ state: 'ready', version: info.version, progress: 100 })
  })

  autoUpdater.on('error', (err) => {
    // A failed update check must never be fatal, and rarely deserves attention:
    // it is usually just no network.
    set({ state: 'error', message: err instanceof Error ? err.message : String(err) })
  })

  setTimeout(() => void check(), FIRST_CHECK_DELAY_MS)
  setInterval(() => void check(), RECHECK_INTERVAL_MS)
}

export async function check(): Promise<void> {
  if (!app.isPackaged) return
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    set({ state: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}

export async function download(): Promise<void> {
  if (!app.isPackaged) return
  try {
    set({ state: 'downloading', progress: 0 })
    await autoUpdater.downloadUpdate()
  } catch (err) {
    set({ state: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}

/**
 * Restart into the new version.
 *
 * `isSilent: false` shows the installer, and `isForceRunAfter: true` brings the
 * app back up afterwards — quitting to a desktop with nothing running is a
 * confusing way to end an update.
 */
export function install(): void {
  if (!app.isPackaged || status.state !== 'ready') return
  autoUpdater.quitAndInstall(false, true)
}
