/**
 * Main process entry: lifecycle, IPC wiring, global hotkey.
 */

import { app, BrowserWindow, globalShortcut, ipcMain } from 'electron'
import { createWindow, getWindow, show, hide, toggle, applySettings } from './window'
import { createTray, destroyTray, setHotkey } from './tray'
import { Send, Invoke, On } from '../shared/ipc'
import * as settings from './settings'
import * as db from './db'
import * as client from './wiki/client'
import * as titles from './wiki/titles'
import * as search from './wiki/search'

/**
 * Claim our identity before anything reads it.
 *
 * Running the built entry directly — `electron out/main/index.js` — makes
 * Electron treat `out/main` as the app root. There is no package.json there, so
 * it falls back to the name "Electron", and both the single-instance lock and
 * the userData directory become shared ground with every other Electron app
 * launched the same way. The visible symptom is the app exiting silently at
 * startup because some unrelated project already holds the lock.
 *
 * This has to run before `requestSingleInstanceLock` and before the first
 * `getPath('userData')`, which is why it sits at module scope.
 */
app.setName('rune-buddy')

/** The accelerator currently registered, so a no-op change is not re-registered. */
let boundHotkey = ''

// A second instance would fight the first over the hotkey and the tray.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', show)
  main()
}

function registerIpc(): void {
  ipcMain.on(Send.Hide, hide)
  ipcMain.on(Send.Log, (_e, message: string) => console.log('[renderer]', message))
  ipcMain.on(Send.Quit, () => app.quit())

  ipcMain.handle(Invoke.GetSettings, () => settings.get())
  ipcMain.on(Send.SetSettings, (_e, patch) => settings.update(patch))

  ipcMain.handle(Invoke.GetTitleIndex, () => titles.state())
  ipcMain.on(Send.SyncTitles, () => {
    // Hand-triggered, so it outranks the crawler. Failures already surface as
    // an 'error' progress event; swallowing the rejection here keeps an
    // unhandled promise out of the log.
    void titles.sync('interactive').catch(() => {})
  })

  ipcMain.handle(Invoke.Search, (_e, query: string) => search.search(query))

  titles.onProgress((progress) => {
    // A finished sync replaced the rows the in-memory haystack was built from.
    if (progress.phase === 'done') search.invalidate()
    getWindow()?.webContents.send(On.SyncProgress, progress)
  })
}

function registerHotkey(accelerator: string): void {
  if (accelerator === boundHotkey) return
  // Re-registering is the whole point: the hotkey is user-configurable, and a
  // stale binding would keep firing alongside the new one.
  globalShortcut.unregisterAll()
  const ok = globalShortcut.register(accelerator, toggle)
  if (!ok) {
    console.warn(`[hotkey] ${accelerator} could not be registered — another app likely owns it`)
    boundHotkey = ''
    return
  }
  boundHotkey = accelerator
}

function main(): void {
  app.whenReady().then(async () => {
    const initial = settings.load()
    db.open()
    client.configure({ contact: initial.contactEmail })

    // Headless: build the index, print a report, exit. Kept out of the normal
    // path so it never opens a window or claims the hotkey.
    if (process.argv.includes('--sync-titles')) {
      await import('./sync-cli').then((m) => m.runSyncCli())
      return
    }

    createWindow(initial)
    createTray(initial.hotkey)
    registerIpc()
    registerHotkey(initial.hotkey)

    settings.onChange((next) => {
      registerHotkey(next.hotkey)
      setHotkey(next.hotkey)
      applySettings(next)
      client.configure({ contact: next.contactEmail })
      getWindow()?.webContents.send(On.Settings, next)
    })

    if (process.env.SMOKE) {
      void import('./smoke').then((m) => m.runSmoke(initial))
    } else {
      // Nothing is shown until asked for. The window exists from launch so the
      // first hotkey press is instant rather than paying for renderer startup.
      getWindow()?.once('ready-to-show', show)

      // First launch has no index and search would find nothing, so this runs
      // unprompted — at background priority, so anything the user does while it
      // works jumps ahead of it.
      if (titles.isStale()) {
        void titles.sync('background').catch((err: unknown) => {
          console.warn('[titles] sync failed:', err instanceof Error ? err.message : err)
        })
      }
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(settings.get())
    })
  })

  // The app lives in the tray, so closing its window must not end the process.
  // Electron's default when the last window closes is to quit, and a registered
  // no-op listener is what overrides that — removing the handler restores the
  // default rather than disabling it.
  app.on('window-all-closed', () => {})

  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
    destroyTray()
    // Closing checkpoints the WAL, so the next launch does not start by
    // replaying one.
    db.close()
  })
}
