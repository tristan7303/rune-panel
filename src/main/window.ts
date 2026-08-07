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

import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import {
  WINDOW,
  On,
  type MotionEvent,
  type MotionMode,
  type Settings,
  type WindowBounds,
} from '../shared/ipc'
import { appIcon } from './icon'
import { openExternal } from './safe-open'
import * as settings from './settings'
import * as anim from './anim'
import * as pane from './tools/pane'

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
      // How main intends to animate, which the renderer has to know
      // *synchronously* at startup — it holds itself collapsed until the first
      // open, and a collapsed transform reports shifted coordinates to anything
      // that measures layout. An IPC round trip would answer a frame or two too
      // late. Later changes ride along on each motion event instead.
      additionalArguments: [`--rp-motion=${anim.mode()}`],
      contextIsolation: true,
      nodeIntegration: false,
      // Inherited as `false` from the project this forked, whose preload
      // needed Node. Ours uses only contextBridge and ipcRenderer, both of
      // which work sandboxed — so the renderer runs in the OS sandbox like any
      // browser tab.
      sandbox: true,
    },
  })

  win.setMenuBarVisibility(false)

  // Anything that tries to open a new window goes to the real browser instead —
  // http and https only. See safe-open.ts for why that matters.
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url)
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
    // The guard inside hide() covers the animation, but checking here keeps a
    // blur fired *by* the collapse from queueing a second close behind it.
    if (settings.get().hideOnBlur && !anim.isBusy()) void hide()
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

/**
 * The rectangle the window belongs at.
 *
 * While an animation is in flight `getBounds()` returns an intermediate, so the
 * full-size rectangle is held here for the duration rather than read back off a
 * window that is mid-collapse.
 */
let restingBounds: WindowBounds | null = null

function target(w: BrowserWindow): WindowBounds {
  return restingBounds ?? w.getBounds()
}

export function show(): void {
  const w = getWindow()
  if (!w || anim.isBusy()) return

  const full = target(w)
  restingBounds = full
  const motion = anim.mode()

  // Start small and invisible, before the first frame is on screen. The
  // renderer is already collapsed — it stays that way for as long as the window
  // is hidden — so there is nothing to prepare and nothing flashes at full size.
  if (!w.isVisible() && motion !== 'none') {
    if (motion === 'scale') w.setBounds(anim.enterRect(full))
    w.setOpacity(0)
  }

  // 'screen-saver' is the level that clears a borderless-fullscreen game
  // client. Re-asserted on every show because another app can steal the top
  // slot while we are hidden.
  if (settings.get().alwaysOnTop) w.setAlwaysOnTop(true, 'screen-saver')
  else w.setAlwaysOnTop(false)
  w.show()
  w.focus()
  // Not the same as `w.focus()`. On a tool route the WebContentsView holds
  // keyboard focus, and the renderer's auto-focus would have nothing to take.
  w.webContents.focus()

  w.webContents.send(On.Motion, motionEvent('open', motion, full))
  w.webContents.send(On.Shown)
  announceVisibility(true)

  void anim.expand(w, full).then(() => {
    // Never leave a visible window part-way transparent, whatever happened on
    // the way here.
    anim.reset(w)
    restingBounds = null
    pane.resume()
  })
}

/**
 * Close, after playing the collapse.
 *
 * Async now, which every caller has to respect: the window is still on screen
 * when this returns control to the event loop, and acting on it in between is
 * how you get two animations fighting over one rectangle.
 */
export async function hide(): Promise<void> {
  const w = getWindow()
  if (!w || !w.isVisible() || anim.isBusy()) return

  const full = target(w)
  restingBounds = full

  pane.suspend()
  w.webContents.send(On.Motion, motionEvent('close', anim.mode(), full))
  await anim.collapse(w, full)

  if (w.isDestroyed()) return
  // Dropping always-on-top while hidden keeps the flag from outliving the
  // window in the compositor's bookkeeping.
  w.setAlwaysOnTop(false)
  w.hide()
  // Opaque again while nobody is looking. `show()` sets it back to zero if it
  // is going to animate, and a window that never gets one is simply visible.
  anim.reset(w)
  // The rectangle is left collapsed, and `restingBounds` deliberately stays set
  // to remember what it should grow back to. Restoring it here instead is the
  // obvious move and the wrong one: `setBounds` on a window that was hidden a
  // moment ago puts it back on screen.
  announceVisibility(false)
}

export function toggle(): void {
  if (anim.isBusy()) return
  if (isVisible()) void hide()
  else show()
}

function motionEvent(
  phase: MotionEvent['phase'],
  mode: MotionMode,
  full: WindowBounds
): MotionEvent {
  return { phase, mode, width: full.width, height: full.height }
}

/** Apply a settings change that the window itself owns. */
export function applySettings(next: Settings): void {
  const w = getWindow()
  if (!w) return
  w.setBackgroundMaterial(next.acrylic ? 'acrylic' : 'none')
  // Only while visible: pinning a hidden window leaves the flag set in the
  // compositor's bookkeeping with nothing to apply it to.
  if (w.isVisible()) {
    w.setAlwaysOnTop(next.alwaysOnTop, next.alwaysOnTop ? 'screen-saver' : 'normal')
  }
}

/**
 * Persist the window rectangle, 400ms after it stops moving.
 *
 * The open/close animation fires `move` and `resize` on every frame, and a
 * shrunken rectangle written to settings would be permanent — the window would
 * reopen at 85% forever. So an animation both skips the save and cancels any
 * save already armed, and `hide()` restores the full rectangle before the
 * window is shown again.
 */
function scheduleSaveBounds(): void {
  if (saveBoundsTimer) clearTimeout(saveBoundsTimer)
  saveBoundsTimer = null
  if (anim.isBusy()) return
  saveBoundsTimer = setTimeout(() => {
    saveBoundsTimer = null
    const w = getWindow()
    // Hidden means the window is sitting at its collapsed rectangle waiting to
    // grow back, which is not a size anyone chose.
    if (w && w.isVisible() && !anim.isBusy()) settings.update({ bounds: w.getBounds() })
  }, 400)
}
