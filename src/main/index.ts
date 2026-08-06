/**
 * Main process entry: lifecycle, IPC wiring, global hotkey.
 */

import { app, BrowserWindow, globalShortcut, ipcMain } from 'electron'
import { createWindow, getWindow, show, hide, toggle, applySettings } from './window'
import { createTray, destroyTray, setHotkey } from './tray'
import { Send, Invoke, On } from '../shared/ipc'
import * as settings from './settings'

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
  app.whenReady().then(() => {
    const initial = settings.load()
    createWindow(initial)
    createTray(initial.hotkey)
    registerIpc()
    registerHotkey(initial.hotkey)

    settings.onChange((next) => {
      registerHotkey(next.hotkey)
      setHotkey(next.hotkey)
      applySettings(next)
      getWindow()?.webContents.send(On.Settings, next)
    })

    if (process.env.SMOKE) {
      void import('./smoke').then((m) => m.runSmoke(initial))
    } else {
      // Nothing is shown until asked for. The window exists from launch so the
      // first hotkey press is instant rather than paying for renderer startup.
      getWindow()?.once('ready-to-show', show)
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
  })
}
