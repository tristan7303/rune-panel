/**
 * Main process entry: lifecycle, IPC wiring, global hotkey.
 */

import { app, BrowserWindow, globalShortcut, ipcMain } from 'electron'
import {
  createWindow,
  getWindow,
  show,
  hide,
  toggle,
  applySettings,
  onVisibilityChange,
} from './window'
import { createTray, destroyTray, setHotkey } from './tray'
import { Send, Invoke, On } from '../shared/ipc'
import * as settings from './settings'
import * as db from './db'
import * as client from './wiki/client'
import * as titles from './wiki/titles'
import * as search from './wiki/search'
import * as page from './wiki/page'
import * as images from './wiki/images'
import * as sync from './wiki/sync'
import * as pane from './tools/pane'
import * as profile from './tools/profile'
import * as ge from './prices/ge'
import * as hiscores from './hiscores'
import * as setup from './setup'
import * as updater from './updater'
import * as anim from './anim'
import type { PaneBounds, ToolId } from '../shared/ipc'

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
app.setName('rune-panel')

// Privileged schemes must be declared before the protocol registry locks at
// app.ready, so this cannot wait for main().
images.registerScheme()

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
  ipcMain.on(Send.Hide, () => void hide())
  ipcMain.on(Send.Log, (_e, message: string) => console.log('[renderer]', message))
  ipcMain.on(Send.Quit, () => app.quit())
  // Main owns half the open/close animation and cannot read a media query, so
  // the renderer reports the preference and main turns its half off to match.
  ipcMain.on(Send.ReduceMotion, (_e, reduce: boolean) => anim.setReducedMotion(reduce))

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

  ipcMain.handle(Invoke.GetPage, (_e, title: string, options?: { force?: boolean }) =>
    page.get(title, options)
  )
  ipcMain.on(Send.PrefetchPage, (_e, title: string) => page.prefetch(title))

  ipcMain.handle(Invoke.GetCrawlState, () => sync.getState())
  ipcMain.on(Send.StartCrawl, () => void sync.run())
  ipcMain.on(Send.StopCrawl, () => sync.stop())

  sync.onProgress((state) => getWindow()?.webContents.send(On.CrawlProgress, state))

  ipcMain.on(Send.ShowTool, (_e, id: ToolId, arg?: string) => {
    void pane.show(id, arg).catch((err: unknown) => {
      console.warn('[tools] show failed:', err instanceof Error ? err.message : err)
    })
  })
  ipcMain.on(Send.HideTool, () => pane.hide())
  ipcMain.on(Send.SetPaneBounds, (_e, bounds: PaneBounds) => pane.setBounds(bounds))
  ipcMain.handle(Invoke.LookupProfile, (_e, username: string) => profile.lookup(username))

  ipcMain.handle(Invoke.GeDetail, (_e, itemId: number, timestep?: ge.Timestep) =>
    ge.detail(itemId, timestep)
  )
  ipcMain.handle(Invoke.GeFindByName, (_e, name: string) => ge.findItemByName(name))

  ipcMain.handle(Invoke.Hiscores, (_e, name: string, mode?: hiscores.AccountMode) =>
    hiscores.lookup(name, mode)
  )

  ipcMain.handle(Invoke.GetSetup, () => setup.getProgress())
  ipcMain.on(Send.RunSetup, (_e, options: { prices: boolean }) => {
    void setup.run(options)
  })
  setup.onProgress((p) => getWindow()?.webContents.send(On.SetupProgress, p))

  ipcMain.handle(Invoke.GetUpdate, () => updater.getStatus())
  ipcMain.on(Send.UpdateCheck, () => void updater.check())
  ipcMain.on(Send.UpdateDownload, () => void updater.download())
  ipcMain.on(Send.UpdateInstall, () => updater.install())
  updater.onStatus((s) => getWindow()?.webContents.send(On.UpdateStatus, s))

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
    images.serve()

    // Headless modes: do the work, print a report, exit. Kept out of the normal
    // path so they never open a window or claim the hotkey.
    if (process.argv.includes('--sync-titles')) {
      await import('./sync-cli').then((m) => m.runSyncCli())
      return
    }
    if (process.argv.includes('--crawl')) {
      await import('./sync-cli').then((m) => m.runCrawlCli())
      return
    }

    // Before the window is created: the renderer is told at construction
    // whether to expect an animation, so this cannot wait for the smoke branch
    // further down. The suite asserts window state and on-screen geometry the
    // instant show/hide returns, and an animation would only make it assert the
    // easing curve.
    if (process.env.SMOKE) anim.disable()
    anim.setUserReducedMotion(initial.reduceMotion)

    const win = createWindow(initial)
    pane.attach(win)
    createTray(initial.hotkey)
    registerIpc()
    registerHotkey(initial.hotkey)

    // Outside the smoke branch below on purpose: in a development build this
    // only records that updates do not apply, and the renderer needs that
    // answer either way.
    updater.init()

    settings.onChange((next) => {
      registerHotkey(next.hotkey)
      setHotkey(next.hotkey)
      applySettings(next)
      anim.setUserReducedMotion(next.reduceMotion)
      client.configure({ contact: next.contactEmail })
      // An open tool pane repaints in place rather than waiting for the next
      // navigation to pick the new theme up.
      void pane.applyTheme()
      getWindow()?.webContents.send(On.Settings, next)
    })

    if (process.env.SMOKE) {
      void import('./smoke').then((m) => m.runSmoke(initial))
    } else {
      // Nothing is shown until asked for. The window exists from launch so the
      // first hotkey press is instant rather than paying for renderer startup.
      getWindow()?.once('ready-to-show', show)

      onVisibilityChange(sync.setWindowVisible)

      // A first run is handed to the setup wizard rather than started silently:
      // the index takes four minutes and search finds nothing until it lands,
      // which reads as a broken app rather than a pending download.
      if (setup.isFirstRun()) {
        // nothing to do here; the renderer shows the wizard and calls runSetup.
      } else if (titles.isStale()) {
        void titles
          .sync('background')
          .then(() => sync.run())
          .catch((err: unknown) => {
            console.warn('[titles] sync failed:', err instanceof Error ? err.message : err)
          })
      } else {
        // Give the window a moment to finish opening before competing for the
        // request queue; the crawler parks itself anyway once it sees the
        // window is visible.
        setTimeout(() => void sync.run(), 5000)
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
    sync.stop()
    pane.destroy()
    // Closing checkpoints the WAL, so the next launch does not start by
    // replaying one.
    db.close()
  })
}
