/**
 * The embedded tools' preload. Theme, before the first pixel.
 *
 * The app's own preload is a bridge; this one is the opposite. It exposes
 * nothing to the page, takes nothing from it, and exists for a single reason:
 * a stylesheet has to be in place *before* the document paints, and there is no
 * other moment that qualifies.
 *
 * Injecting from main is always too late. `insertCSS` needs a document to
 * insert into, so the earliest it can land is `dom-ready` — and by then the
 * page has painted its own background at least once. On a site that ships white
 * that is a full-pane white flash on every navigation, which in a dark theme is
 * the brightest thing on screen.
 *
 * A preload runs before any of the page's own scripts and before first paint,
 * so the styles are simply already there.
 *
 * The fetch is synchronous, which is normally the wrong instinct and is right
 * here: the whole value is in having the answer *now*, and an async round trip
 * would put the injection back after the paint it exists to precede. It is one
 * message, at document start, to our own main process.
 */

import { ipcRenderer, webFrame } from 'electron'

/** Must match `Send.PaneThemeCss` in shared/ipc.ts — imported by neither side. */
const CHANNEL = 'tools:theme-css'

try {
  const css: unknown = ipcRenderer.sendSync(CHANNEL)
  if (typeof css === 'string' && css.length > 0) {
    // Not awaited: the promise resolves after the stylesheet is registered, and
    // registration itself is synchronous enough to beat the first paint.
    void webFrame.insertCSS(css)
  }
} catch {
  // A tool with no styling, or main not ready to answer. The page renders in
  // its own colours, which is exactly what happened before this file existed.
}
