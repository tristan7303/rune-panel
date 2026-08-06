/**
 * The embedded browser pane.
 *
 * One `WebContentsView`, reused across all three tools. A real view rather than
 * an iframe because these are third-party origins with their own cookies,
 * storage and framing rules — and rather than glass-agent's offscreen renderer
 * because nothing here composites on top of it, so there is no reason to pay
 * for a texture copy.
 *
 * The one thing to remember about `WebContentsView`: it composites *above* the
 * DOM, always. It is not part of the page and cannot be layered, clipped by
 * overflow, or covered by a dialog. Every rule below follows from that — the
 * bounds are set to exactly the content area so it never sits over the rail,
 * and it is hidden the moment the route changes rather than left underneath
 * something, because there is no underneath.
 */

import { WebContentsView, shell, session, type BrowserWindow, type Rectangle } from 'electron'
import { TOOLS, PALETTES, type ToolCookie, type ToolId } from './registry'
import * as settings from '../settings'

/** Shared so a login or a preference survives switching tools and restarts. */
const PARTITION = 'persist:tools'

let view: WebContentsView | null = null
let host: BrowserWindow | null = null
let current: { id: ToolId; arg?: string } | null = null
let bounds: Rectangle = { x: 0, y: 0, width: 0, height: 0 }
let injectionEnabled = true
/** Handle for the stylesheet we injected, so a re-theme can replace it. */
let injectedKey: string | null = null

export function attach(window: BrowserWindow): void {
  host = window
  // Bounds are given in DIP relative to the window, so a resize invalidates
  // them and the renderer has to re-measure.
  window.on('resize', () => applyBounds())
}

export function setInjectionEnabled(enabled: boolean): void {
  injectionEnabled = enabled
}

/**
 * Show a tool, creating the view on first use.
 *
 * Lazily, because most sessions never open one and a `WebContentsView` is a
 * whole renderer process.
 */
export async function show(id: ToolId, arg?: string): Promise<void> {
  if (!host) return
  const tool = TOOLS[id]

  if (!view) {
    view = new WebContentsView({
      webPreferences: {
        partition: PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        // No preload: these are third-party pages and get no bridge to us.
      },
    })
    host.contentView.addChildView(view)
    wire(view)
  }

  view.setVisible(true)
  applyBounds()

  const url = tool.url(arg)
  const same = current?.id === id && current.arg === arg
  current = { id, arg }
  if (same && view.webContents.getURL()) return

  await setCookies(tool.cookies)
  injectedKey = null
  await view.webContents.loadURL(url)
}

/**
 * The pane's webContents, for the smoke suite only.
 *
 * Exposed so the chrome-hiding CSS can be asserted against the real page rather
 * than assumed. Nothing in the app proper reaches into the pane this way.
 */
export function debugWebContents(): Electron.WebContents | null {
  return view?.webContents ?? null
}

/** Whether the pane is currently on screen. For the smoke suite only. */
export function debugVisible(): boolean {
  return view?.getVisible() ?? false
}

/** The pane's current rectangle. For the smoke suite only. */
export function debugBounds(): Rectangle {
  return { ...bounds }
}

/**
 * Push the current theme into the pane.
 *
 * Runs on load and again whenever the theme changes, so switching to parchment
 * repaints an already-open calculator rather than leaving it dark until the
 * next navigation. The script goes first: it puts the site into the light or
 * dark mode our palette is written against, so the CSS is not fighting the
 * page's own choice.
 */
export async function applyTheme(): Promise<void> {
  if (!view || !current) return
  const tool = TOOLS[current.id]
  const palette = PALETTES[settings.get().theme] ?? PALETTES.dark

  try {
    if (tool.js) await view.webContents.executeJavaScript(tool.js(palette))
    if (injectionEnabled && tool.css) {
      // Replace rather than stack: insertCSS returns a key precisely because
      // repeated calls otherwise pile up a stylesheet per theme change.
      if (injectedKey) await view.webContents.removeInsertedCSS(injectedKey).catch(() => '')
      injectedKey = await view.webContents.insertCSS(tool.css(palette))
    }
  } catch (err) {
    console.warn(`[tools] ${current.id} theme:`, err instanceof Error ? err.message : err)
  }
}

export function hide(): void {
  // setVisible(false) rather than removeChildView: the page keeps its state, so
  // returning to a half-filled DPS loadout does not start over.
  view?.setVisible(false)
}

export function destroy(): void {
  if (!view) return
  if (host && !host.isDestroyed()) host.contentView.removeChildView(view)
  view.webContents.close()
  view = null
  current = null
}

/**
 * Where the renderer says the content area is.
 *
 * Measured in the renderer and sent over, because only it knows how wide the
 * rail ended up. Rounded because fractional bounds make the embedded page
 * blurry at non-integer scale factors.
 */
export function setBounds(next: Rectangle): void {
  bounds = {
    x: Math.round(next.x),
    y: Math.round(next.y),
    width: Math.max(0, Math.round(next.width)),
    height: Math.max(0, Math.round(next.height)),
  }
  applyBounds()
}

function applyBounds(): void {
  view?.setBounds(bounds)
}

function wire(v: WebContentsView): void {
  const wc = v.webContents

  // Links that leave the tool go to the real browser. Without this a stray
  // footer link strands the pane on an unrelated site with no way back.
  wc.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  wc.on('will-navigate', (event, url) => {
    const allowed = current ? TOOLS[current.id].allowNavigation.test(url) : false
    if (allowed) return
    event.preventDefault()
    void shell.openExternal(url)
  })

  // Re-injected on every navigation, not just the first: these are real sites
  // and clicking within one loads a fresh document.
  wc.on('did-finish-load', () => void applyTheme())

  wc.on('did-fail-load', (_e, code, description, url) => {
    // -3 is ERR_ABORTED, which is what a superseded navigation looks like.
    if (code === -3) return
    console.warn(`[tools] load failed ${code} ${description}: ${url}`)
  })
}

async function setCookies(cookies: ToolCookie[] | undefined): Promise<void> {
  if (!cookies?.length) return
  const jar = session.fromPartition(PARTITION).cookies
  await Promise.all(
    cookies.map((c) =>
      jar
        .set({ url: c.url, name: c.name, value: c.value, sameSite: 'lax' })
        .catch((err: unknown) => {
          console.warn(`[tools] cookie ${c.name}:`, err instanceof Error ? err.message : err)
        })
    )
  )
}
