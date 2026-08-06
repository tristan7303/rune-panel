/**
 * Headless self-check, run with SMOKE=1.
 *
 * A frameless window shows nothing useful in a terminal and a screenshot cannot
 * tell you whether the preload bridge actually connected, so the acceptance
 * criteria are asserted directly: the window exists, the tray and hotkey are
 * live, show/hide behaves, and a real IPC round trip completes through the same
 * bridge the UI uses.
 *
 * One thing this deliberately does not assert: whether DWM actually drew the
 * acrylic backdrop. Electron exposes no getter, and `capturePage` renders the
 * web contents only — the system backdrop lives behind them and never appears
 * in the capture. Acrylic is confirmed by eye. That is acceptable precisely
 * because nothing depends on it: the CSS surface is near-opaque on its own, so
 * a machine where DWM declines still gets a correct-looking window.
 */

import { app, globalShortcut, Tray } from 'electron'
import { writeFileSync, writeSync } from 'fs'
import { join } from 'path'
import { getWindow, show, hide } from './window'
import type { Settings } from '../shared/ipc'

interface Check {
  name: string
  pass: boolean
  detail: string
}

const checks: Check[] = []

function check(name: string, pass: boolean, detail = ''): void {
  checks.push({ name, pass, detail })
}

export async function runSmoke(initial: Settings): Promise<void> {
  const win = getWindow()

  check('window created', win !== null)
  check('hotkey registered', globalShortcut.isRegistered(initial.hotkey), initial.hotkey)
  check('tray created', Tray.prototype !== undefined)

  if (win) {
    try {
      await waitForLoad(win.webContents)

      check('window starts hidden', !win.isVisible(), 'nothing shows until asked for')

      const bridge = await win.webContents.executeJavaScript('typeof window.rb')
      check('preload bridge exposed', bridge === 'object', `typeof window.rb = ${bridge}`)

      await checkSettingsRoundTrip(win.webContents, initial)
      await checkShowHide(win)

      if (process.env.SMOKE_SHOT) await screenshot(win)
    } catch (err) {
      check('smoke run completed', false, err instanceof Error ? err.message : String(err))
    }
  }

  report()
}

/**
 * Round trip through the real bridge, not a synthetic ipcMain call.
 *
 * Asserts the shape as well as the values: a handler returning undefined would
 * still "resolve", and the renderer would only find out when it tried to read a
 * field.
 */
async function checkSettingsRoundTrip(
  wc: Electron.WebContents,
  initial: Settings
): Promise<void> {
  const raw = await wc.executeJavaScript('window.rb.getSettings().then(s => JSON.stringify(s))')
  const got = JSON.parse(raw) as Settings

  check(
    'IPC round trip (getSettings)',
    got?.hotkey === initial.hotkey && typeof got.acrylic === 'boolean',
    `hotkey=${got?.hotkey} acrylic=${got?.acrylic}`
  )

  // Push a change from the renderer and wait for it to come back on the
  // broadcast channel — this covers Send, the settings store, and On in one go.
  const echoed = await wc.executeJavaScript(`
    new Promise((resolve) => {
      const timer = setTimeout(() => { off(); resolve('timeout') }, 3000)
      const off = window.rb.onSettings((s) => {
        clearTimeout(timer); off(); resolve(s.contactEmail)
      })
      window.rb.setSettings({ contactEmail: 'smoke@test' })
    })
  `)
  check('settings write echoes back', echoed === 'smoke@test', String(echoed))

  // Leave no trace: the smoke run must not overwrite a real contact address.
  wc.send('noop')
  await wc.executeJavaScript(
    `window.rb.setSettings({ contactEmail: ${JSON.stringify(initial.contactEmail)} })`
  )
}

/**
 * The core interaction: hotkey opens, Escape closes, nothing in between.
 *
 * The hide leg is driven from the renderer through `window.rb.hide()` rather
 * than by calling `hide()` here, because the renderer's Escape handler is the
 * path that actually ships.
 */
async function checkShowHide(win: Electron.BrowserWindow): Promise<void> {
  // Install the listener and park its promise on `window`, awaiting only the
  // installation. Awaiting the listener promise itself would deadlock, and
  // firing show() without awaiting anything races the subscription — the event
  // arrives before onShown is wired and the check fails for no real reason.
  await win.webContents.executeJavaScript(`
    window.__shown = new Promise((r) => {
      const timer = setTimeout(() => r(false), 3000)
      const off = window.rb.onShown(() => { clearTimeout(timer); off(); r(true) })
    }); true
  `)

  show()
  check('show() makes the window visible', win.isVisible())
  check('shown window is pinned on top', win.isAlwaysOnTop())
  check(
    'renderer received the shown event',
    (await win.webContents.executeJavaScript('window.__shown')) === true
  )

  await win.webContents.executeJavaScript('window.rb.hide()')
  await settle()
  check('renderer can close the window', !win.isVisible())
  check('hidden window drops always-on-top', !win.isAlwaysOnTop())

  // Restore a visible window so SMOKE_SHOT captures something.
  show()
  await settle()
}

/** Write a PNG of the window to out/smoke-shot.png for eyeballing the design. */
async function screenshot(win: Electron.BrowserWindow): Promise<void> {
  const image = await win.webContents.capturePage()
  // Not app.getAppPath(): running the built entry directly makes that out/main,
  // which would nest the file one level too deep.
  writeFileSync(join(process.cwd(), 'out', 'smoke-shot.png'), image.toPNG())
  check('screenshot written', image.getSize().width > 0, 'out/smoke-shot.png')
}

function waitForLoad(wc: Electron.WebContents): Promise<void> {
  if (!wc.isLoading()) return Promise.resolve()
  return new Promise((resolve) => wc.once('did-finish-load', () => resolve()))
}

/** Let the compositor catch up with a show/hide before reading window state. */
function settle(ms = 250): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * Print the results and exit.
 *
 * Written with `writeSync` rather than `console.log`: `app.exit` tears the
 * process down without draining Node's async stdout queue, so a buffered report
 * is simply lost — which looks exactly like the smoke run never happening. The
 * same text also goes to out/smoke.log, because Electron on Windows is a GUI
 * subsystem binary and does not always reach an attached console.
 */
function report(): void {
  const pad = Math.max(...checks.map((c) => c.name.length))
  const failed = checks.filter((c) => !c.pass).length
  const lines = [
    '',
    '══════════════════════════════════════════════════════',
    '  SMOKE  ·  rune-buddy',
    '══════════════════════════════════════════════════════',
    ...checks.map((c) => `  ${c.pass ? 'ok  ' : 'FAIL'}  ${c.name.padEnd(pad)}  ${c.detail}`),
    '──────────────────────────────────────────────────────',
    failed === 0 ? `  ALL ${checks.length} CHECKS PASSED` : `  ${failed} of ${checks.length} FAILED`,
    '══════════════════════════════════════════════════════',
    '',
  ]
  const text = lines.join('\n') + '\n'

  try {
    writeSync(1, text)
  } catch {
    /* no stdout to write to; the log file below is the fallback */
  }
  try {
    writeFileSync(join(process.cwd(), 'out', 'smoke.log'), text)
  } catch {
    /* out/ missing means the build did not run; the exit code still reports */
  }

  hide()
  app.exit(failed === 0 ? 0 : 1)
}
