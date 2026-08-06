/**
 * The window.
 *
 * Rune Panel is either open or closed — there is no ambient resting state. That
 * one decision removes most of what a transparent HUD normally needs: no
 * click-through hit testing, no z-order sinking below the desktop, no custom
 * cursor, and no `setContentProtection`. The window is a normal top-level
 * window that happens to be frameless and summoned by a hotkey, which also
 * means it stays visible in OBS and Discord — worth having for a game tool.
 *
 * The frosted look comes from `backgroundMaterial: 'acrylic'`, the DWM system
 * backdrop (Windows 11 22H2+). Two things it needs, both easy to break:
 * `transparent` must be false, and `backgroundColor` must carry a zero alpha,
 * or DWM has nothing to blur through. Everything is designed to survive DWM
 * declining anyway — the CSS surface is near-opaque on its own, so acrylic only
 * ever adds depth.
 */

import { BrowserWindow, screen, shell } from 'electron'
import { join } from 'path'
import { WINDOW, On, type Settings, type WindowBounds } from '../shared/ipc'
import { appIcon } from './icon'
import * as settings from './settings'

let win: BrowserWindow | null = null
/** Debounce handle for persisting bounds; move/resize fire per frame while dragging. */
let saveBoundsTimer: NodeJS.Timeout | null = null

/** Place the window centered on whichever display holds the cursor. */
function defaultBounds(): WindowBounds {
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  const width = Math.min(WINDOW.width, area.width - 80)
  const height = Math.min(WINDOW.height, area.height - 80)
  return {
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2),
    width,
    height,
  }
}

/**
 * Reject saved bounds that no longer land on a connected display.
 *
 * Unplugging the monitor a window was last closed on would otherwise restore it
 * to coordinates nothing can show, and a window you cannot see is
 * indistinguishable from one that failed to launch.
 */
function usableBounds(saved: WindowBounds | null): WindowBounds {
  if (!saved) return defaultBounds()
  const onScreen = screen.getAllDisplays().some((d) => {
    const a = d.workArea
    return (
      saved.x < a.x + a.width &&
      saved.x + saved.width > a.x &&
      saved.y < a.y + a.height &&
      saved.y + saved.height > a.y
    )
  })
  if (!onScreen) return defaultBounds()
  return {
    ...saved,
    width: Math.max(saved.width, WINDOW.minWidth),
    height: Math.max(saved.height, WINDOW.minHeight),
  }
}

export function createWindow(initial: Settings): BrowserWindow {
  const bounds = usableBounds(initial.bounds)

  win = new BrowserWindow({
    ...bounds,
    minWidth: WINDOW.minWidth,
    minHeight: WINDOW.minHeight,
    show: false,
    frame: false,
    // Acrylic and `transparent: true` are mutually exclusive on Windows — the
    // latter takes the window out of DWM's backdrop path entirely.
    transparent: false,
    backgroundMaterial: initial.acrylic ? 'acrylic' : 'none',
    // Zero alpha, so the backdrop shows through. With acrylic off this reads as
    // plain black for the one frame before the renderer paints.
    backgroundColor: '#00000000',
    roundedCorners: true,
    skipTaskbar: true,
    title: 'Rune Panel',
    icon: appIcon(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  win.setMenuBarVisibility(false)

  // Anything that tries to open a new window goes to the real browser instead.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  // electron-vite serves the renderer from a dev server when running `dev`, and
  // emits it to out/renderer for a built app.
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  win.on('move', scheduleSaveBounds)
  win.on('resize', scheduleSaveBounds)

  win.on('blur', () => {
    if (settings.get().hideOnBlur) hide()
  })

  win.on('closed', () => {
    win = null
  })

  return win
}

export function getWindow(): BrowserWindow | null {
  return win && !win.isDestroyed() ? win : null
}

export function isVisible(): boolean {
  return getWindow()?.isVisible() ?? false
}

type VisibilityListener = (visible: boolean) => void
const visibilityListeners = new Set<VisibilityListener>()

/**
 * Watch show/hide.
 *
 * The background crawler subscribes to this so it can park while you are
 * reading: bandwidth and the request queue belong to whatever is on screen.
 */
export function onVisibilityChange(listener: VisibilityListener): void {
  visibilityListeners.add(listener)
}

function announceVisibility(visible: boolean): void {
  for (const listener of visibilityListeners) listener(visible)
}

export function show(): void {
  const w = getWindow()
  if (!w) return
  // 'screen-saver' is the level that clears a borderless-fullscreen game client.
  // Re-asserted on every show because another app can steal the top slot while
  // we are hidden.
  w.setAlwaysOnTop(true, 'screen-saver')
  w.show()
  w.focus()
  w.webContents.send(On.Shown)
  announceVisibility(true)
}

export function hide(): void {
  const w = getWindow()
  if (!w || !w.isVisible()) return
  // Dropping always-on-top while hidden keeps the flag from outliving the
  // window in the compositor's bookkeeping.
  w.setAlwaysOnTop(false)
  w.hide()
  announceVisibility(false)
}

export function toggle(): void {
  if (isVisible()) hide()
  else show()
}

/** Apply a settings change that the window itself owns. */
export function applySettings(next: Settings): void {
  getWindow()?.setBackgroundMaterial(next.acrylic ? 'acrylic' : 'none')
}

function scheduleSaveBounds(): void {
  if (saveBoundsTimer) clearTimeout(saveBoundsTimer)
  saveBoundsTimer = setTimeout(() => {
    saveBoundsTimer = null
    const w = getWindow()
    if (w) settings.update({ bounds: w.getBounds() })
  }, 400)
}
