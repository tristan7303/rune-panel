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
import { TOOLS, type ToolCookie, type ToolId } from './registry'

/** Shared so a login or a preference survives switching tools and restarts. */
const PARTITION = 'persist:tools'

let view: WebContentsView | null = null
let host: BrowserWindow | null = null
let current: { id: ToolId; arg?: string } | null = null
let bounds: Rectangle = { x: 0, y: 0, width: 0, height: 0 }
let injectionEnabled = true

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
  wc.on('did-finish-load', () => {
    if (!injectionEnabled || !current) return
    const css = TOOLS[current.id].css
    if (!css) return
    wc.insertCSS(css).catch((err: unknown) => {
      console.warn(`[tools] ${current?.id} css:`, err instanceof Error ? err.message : err)
    })
  })

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
