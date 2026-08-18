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

import { join } from 'path'
import { WebContentsView, session, type BrowserWindow, type Input, type Rectangle } from 'electron'
import { TOOLS, PALETTES, type ToolCookie, type ToolId, type ToolPalette } from './registry'
import { openExternal } from '../safe-open'
import * as settings from '../settings'
import { On, type PaneShortcut } from '../../shared/ipc'
import { parseCombo } from '../../shared/keys'

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

  /**
   * Recorded before the view exists, not after.
   *
   * A freshly constructed `WebContentsView` loads `about:blank` immediately,
   * and its preload asks for the stylesheet as part of that. Setting `current`
   * afterwards meant the very first ask was answered with nothing, so the blank
   * document kept its default white — and that document is what is on screen
   * for the whole of the first load.
   */
  const same = current?.id === id && current.arg === arg
  current = { id, arg }

  if (!view) {
    view = new WebContentsView({
      webPreferences: {
        partition: PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        /**
         * Not a bridge. It exposes nothing to the page and reads nothing from
         * it — its whole job is to put the theme's stylesheet in place before
         * the document paints, which is the one thing main cannot do from
         * outside. See src/preload/pane.ts.
         */
        /**
         * `../preload/`, not `./` — this main chunk lives in out/main and the
         * preloads are emitted to out/preload. The first version of this line
         * pointed into out/main, where no pane.js exists, so the preload
         * silently never loaded and every anti-flash measure built on it was
         * fighting a file that was not there.
         */
        preload: join(__dirname, '../preload/pane.js'),
      },
    })
    host.contentView.addChildView(view)
    wire(view)
  }

  /**
   * Paint the view our surface colour before anything loads.
   *
   * A `WebContentsView` defaults to white, so every navigation used to flash a
   * white rectangle the size of the pane before the site's own background
   * arrived — worst on a dark theme, where it is the brightest thing on screen.
   * This costs nothing and there is no document involved, so it applies
   * immediately rather than waiting on a load.
   */
  view.setBackgroundColor(PALETTES[settings.get().theme]?.surface ?? PALETTES.dark.surface)

  applyBounds()
  applyScale()

  const url = tool.url(arg)
  if (same && view.webContents.getURL()) {
    view.setVisible(true)
    return
  }

  await setCookies(tool.cookies)
  injectedKey = null

  // Hidden for the duration of the navigation: leaving it visible showed the
  // previous document — another tool, or about:blank — for the whole load.
  view.setVisible(false)
  emitLoading(true)

  /**
   * Shown at `dom-ready`, not at the end of the load.
   *
   * This used to await `loadURL`, whose promise only resolves at
   * `did-finish-load` — after every subresource, which on an ad-heavy site
   * means several seconds of spinner over a page that was parsed, themed and
   * showable almost immediately. `dom-ready` is the moment there is a document
   * to look at, and the preload has already put our stylesheet in place before
   * its first paint, so showing here cannot flash the site's own colours.
   * Late-rendering content still gets the `did-finish-load` re-theme in
   * `wire`.
   *
   * The race handles the other order: a navigation that fails outright
   * rejects `loadURL` before any `dom-ready`, and landing in the catch is
   * what takes the spinner down instead of leaving it forever.
   */
  const token = ++navToken
  const wc = view.webContents
  let readyListener: (() => void) | null = null
  try {
    const domReady = new Promise<void>((resolve) => {
      readyListener = () => {
        // A freshly created view is still finishing about:blank when the real
        // navigation starts; its dom-ready must not show an empty document.
        if (wc.getURL() === 'about:blank') return
        resolve()
      }
      wc.on('dom-ready', readyListener)
    })
    const load = wc.loadURL(url)
    // The load usually outlives the race; its failures are reported by the
    // `did-fail-load` handler, so the leftover rejection just needs defusing.
    load.catch(() => undefined)
    await Promise.race([domReady, load])

    // A later show() superseded this one; it owns the view and spinner now.
    if (token !== navToken) return

    /**
     * Loaded is not the same as styled, and it is styled that matters.
     *
     * `applyTheme` is fired from `dom-ready`, but nothing waited for it —
     * `insertCSS` is async, so the view could be shown with the injection
     * still in flight. Awaited here, so the first frame that reaches the
     * screen is already ours.
     */
    await applyTheme()
    if (token !== navToken) return
    view.setVisible(true)
  } catch (err) {
    console.warn(`[tools] ${id} load:`, err instanceof Error ? err.message : err)
  } finally {
    if (readyListener) wc.off('dom-ready', readyListener)
    if (token === navToken) emitLoading(false)
  }
}

/**
 * Which navigation the pane currently belongs to.
 *
 * Bumped by every `show` that starts one. Switching tools mid-load leaves the
 * first `show` suspended at its `await`; when it wakes, the token no longer
 * matches and it must not touch the view — showing it would put the *second*
 * tool's half-loaded page on screen, and dropping the spinner would strand the
 * load that is still genuinely in flight.
 */
let navToken = 0

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
/**
 * What the pane gets whatever page is in it: the surface it sits on, and its
 * scrollbars.
 *
 * Both are unconditional, and for the same reason. Turning the site styling off
 * means "show me the plain site" — it does not mean "flash white at me first",
 * and it does not mean a Windows-grey scrollbar down the edge of a dark window.
 * Neither of these touches the page's own content; they paint the furniture the
 * page is framed in, which belongs to the app around it.
 */
function baseCss(palette: ToolPalette): string {
  return `
html, body { background-color: ${palette.surface}; }

/**
 * Neutralise any scrollbar-color the page sets.
 *
 * Load-bearing rather than tidy: Chromium ignores the ::-webkit-scrollbar
 * pseudo-elements entirely on any scroller whose scrollbar-color is something
 * other than 'auto'. A site that themes its own scrollbars — and the ones
 * embedded here do — would silently defeat every rule below it.
 */
* { scrollbar-color: auto !important; }

::-webkit-scrollbar { width: 12px; height: 12px; }

::-webkit-scrollbar-track,
::-webkit-scrollbar-corner { background: ${palette.sunken}; }

/* The border paints in the track's colour, which is what insets the thumb into
   a lozenge rather than a bar filling the full gutter. */
::-webkit-scrollbar-thumb {
  background: ${palette.rim};
  border: 3px solid ${palette.sunken};
  border-radius: 8px;
}

::-webkit-scrollbar-thumb:hover { background: ${palette.textDim}; }
`.trim()
}

/**
 * The stylesheet for whatever is showing, or empty when there is nothing to
 * say. Read synchronously by the pane's preload before its first paint.
 */
export function themeCss(): string {
  const palette = PALETTES[settings.get().theme] ?? PALETTES.dark
  const base = baseCss(palette)

  if (!current || !injectionEnabled) return base
  const tool = TOOLS[current.id]
  return tool.css ? `${base}
${tool.css(palette)}` : base
}

export async function applyTheme(): Promise<void> {
  if (!view || !current) return
  const tool = TOOLS[current.id]
  const palette = PALETTES[settings.get().theme] ?? PALETTES.dark

  try {
    if (tool.js) await view.webContents.executeJavaScript(tool.js(palette))

    // The base goes in here as well as through the preload, because the preload
    // only runs on navigation: without this, switching theme with a calculator
    // already open would repaint the page and leave its scrollbars in the old
    // one. Replace rather than stack — `insertCSS` returns a key precisely
    // because repeated calls otherwise pile up a stylesheet per theme change.
    const css = injectionEnabled && tool.css ? `${baseCss(palette)}\n${tool.css(palette)}` : baseCss(palette)
    if (injectedKey) await view.webContents.removeInsertedCSS(injectedKey).catch(() => '')
    injectedKey = await view.webContents.insertCSS(css)
  } catch (err) {
    console.warn(`[tools] ${current.id} theme:`, err instanceof Error ? err.message : err)
  }
}

/**
 * The pane as it looks right now, for the freeze-frame swap.
 *
 * `capturePage` reads back what is already composited, so it is cheap and it
 * cannot disturb the page. Null when there is nothing to photograph — the
 * caller falls back to hiding with nothing in its place, which is merely the
 * old behaviour.
 */
type LoadingListener = (loading: boolean) => void
const loadingListeners = new Set<LoadingListener>()

/**
 * Whether the pane is mid-navigation.
 *
 * The view is deliberately not shown until its page has loaded *and* been
 * themed, which is what stopped the unstyled flash — but that leaves a second
 * or so of nothing where the page will be. The renderer draws a spinner in the
 * slot for exactly that window, so the wait reads as loading rather than as
 * having gone wrong.
 */
export function onLoading(listener: LoadingListener): () => void {
  loadingListeners.add(listener)
  return () => loadingListeners.delete(listener)
}

function emitLoading(loading: boolean): void {
  for (const listener of loadingListeners) listener(loading)
}

export async function capture(): Promise<string | null> {
  if (!view || !current) return null
  try {
    const image = await view.webContents.capturePage()
    return image.isEmpty() ? null : image.toDataURL()
  } catch {
    return null
  }
}

export function hide(): void {
  // setVisible(false) rather than removeChildView: the page keeps its state, so
  // returning to a half-filled DPS loadout does not start over.
  view?.setVisible(false)
  suspended = false
}

/** Set only by `suspend`, so `resume` knows whether there was anything to restore. */
let suspended = false

/**
 * Take the pane off screen for the duration of the open/close animation.
 *
 * The view composites above the DOM and is not affected by a CSS transform, so
 * without this, closing on the DPS calculator would show a shrinking frame with
 * a full-size browser rectangle stapled on top of it.
 */
export function suspend(): void {
  if (!view || !view.getVisible()) return
  view.setVisible(false)
  suspended = true
}

/** Put it back, if `suspend` was the thing that took it away. */
export function resume(): void {
  if (!view || !suspended) return
  suspended = false
  view.setVisible(true)
  // The shell was frozen at its full size throughout, so the rectangle the
  // renderer last measured is still the right one.
  applyBounds()
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

/**
 * The embedded page scales with the rest of the interface.
 *
 * The renderer multiplies the slot's rectangle by the same factor before
 * sending it, so the pane keeps the same share of the window whatever the scale
 * is. Without this the rectangle grew and the site inside it did not, which read
 * as everything in the app getting larger except the one page you were looking
 * at.
 */
export function applyScale(): void {
  view?.webContents.setZoomFactor(settings.get().uiScale)
}

function wire(v: WebContentsView): void {
  const wc = v.webContents

  // Links that leave the tool go to the real browser. Without this a stray
  // footer link strands the pane on an unrelated site with no way back.
  //
  // Scheme-checked, and this is the site where it counts: these are
  // third-party pages, and `window.open('file:///…')` from one of them — or
  // from an ad script it loaded — would otherwise reach the shell.
  wc.setWindowOpenHandler(({ url }) => {
    openExternal(url)
    return { action: 'deny' }
  })

  /**
   * Off-site navigation is blocked, not forwarded.
   *
   * This used to hand the URL to `shell.openExternal`, which meant anything
   * that navigated the pane away could open a tab in the real browser — and
   * these pages do carry ad and tracker redirects; one turned up in testing.
   * Handing an arbitrary redirect chain to the user's browser is not something
   * an embedded panel should be able to do on its own.
   *
   * Genuine link clicks still leave: they go through `setWindowOpenHandler`
   * above, which only fires for `target=_blank` and `window.open` — an actual
   * request for a new window rather than a redirect the page performed on
   * itself.
   */
  wc.on('will-navigate', (event, url) => {
    const allowed = current ? TOOLS[current.id].allowNavigation.test(url) : false
    if (allowed) return
    event.preventDefault()
    console.warn(`[tools] blocked off-site navigation: ${url.slice(0, 120)}`)
  })

  /**
   * App shortcuts, while the keyboard belongs to somebody else's page.
   *
   * The renderer listens for Ctrl+F and Ctrl+G on its own document, and a
   * `WebContentsView` is a different document — so with a pane focused the two
   * shortcuts that get you back to searching did nothing, on the four routes
   * where you are most likely to want them.
   *
   * Matched against the same specs the renderer uses, from shared/keys.ts, and
   * consumed rather than passed on: Ctrl+F is a find bar on most sites, and
   * having it open one *and* focus our search would be worse than either.
   */
  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const { searchKey, geKey } = settings.get()
    const which = matchShortcut(input, searchKey, geKey)
    if (!which) return
    event.preventDefault()
    // Focus has to come back before the renderer can put a caret anywhere. The
    // pane holds it at the OS level, so calling `.focus()` on a DOM input in
    // the host window would move nothing and the next keystroke would still go
    // to the website.
    const window = getHost()
    if (!window) return
    window.webContents.focus()
    window.webContents.send(On.PaneShortcut, which)
  })

  /**
   * Theme as early as there is a document to theme.
   *
   * `dom-ready` fires once the markup is parsed; `did-finish-load` waits for
   * every subresource, which on GE Tracker means dozens of advertising frames
   * and several seconds of the site in its own colours before ours arrive.
   *
   * Both are kept. The first is what you see, the second is a backstop for
   * anything the page renders late — and re-injecting is cheap, because
   * `applyTheme` replaces its stylesheet rather than stacking another one.
   *
   * Re-run on every navigation, not just the first: these are real sites and
   * clicking within one loads a fresh document.
   */
  wc.on('dom-ready', () => {
    void applyTheme()
    // Zoom is per-document, so a fresh navigation starts back at 1.
    applyScale()
  })
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

/** The host window, for sending forwarded shortcuts back to the renderer. */
function getHost(): BrowserWindow | null {
  return host && !host.isDestroyed() ? host : null
}

/** Does this keystroke belong to the app rather than the page under it? */
function matchShortcut(input: Input, searchKey: string, geKey: string): PaneShortcut | null {
  for (const [spec, which] of [
    [searchKey, 'search'],
    [geKey, 'ge'],
  ] as Array<[string, PaneShortcut]>) {
    const combo = parseCombo(spec)
    if (!combo) continue
    if (
      combo.ctrl === (input.control || input.meta) &&
      combo.alt === input.alt &&
      combo.shift === input.shift &&
      combo.key === input.key.toLowerCase()
    ) {
      return which
    }
  }
  return null
}
