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
 * page has painted at least once, in its own colours. A preload runs before any
 * of the page's own scripts and before first paint, on every navigation, so the
 * styles are simply already there.
 *
 * The fetch is synchronous, which is normally the wrong instinct and is right
 * here: the whole value is in having the answer *now*, and an async round trip
 * would put the injection back after the paint it exists to precede.
 *
 * Injection is a `<style>` element rather than `webFrame.insertCSS`. Sandboxed
 * preloads get a polyfilled subset of the electron module, and betting the
 * feature on which webFrame methods the polyfill carries is how the first
 * version of this file failed silently. A DOM node needs nothing but the
 * document, and the document is always there.
 */

/// <reference lib="dom" />

import { ipcRenderer } from 'electron'

/** Must match `Send.PaneThemeCss` in shared/ipc.ts — imported by neither side. */
const CHANNEL = 'tools:theme-css'

try {
  const css: unknown = ipcRenderer.sendSync(CHANNEL)
  if (typeof css === 'string' && css.length > 0) {
    const inject = (): void => {
      const style = document.createElement('style')
      // A marker, so "did the preload actually run" is a query rather than an
      // inference. The path bug this file has already survived was invisible
      // precisely because nothing observable said it had not loaded.
      style.setAttribute('data-rp-theme', '')
      style.textContent = css
      ;(document.head ?? document.documentElement).appendChild(style)
    }

    if (document.documentElement) {
      inject()
    } else {
      // The preload can run before the document has a root element. Waiting for
      // one via observer still lands before any content is parsed under it,
      // which is all "before first paint" requires.
      new MutationObserver((_mutations: MutationRecord[], observer: MutationObserver) => {
        if (!document.documentElement) return
        inject()
        observer.disconnect()
      }).observe(document, { childList: true })
    }
  }
} catch {
  // Main not ready to answer, or a tool with nothing to say. The page renders
  // in its own colours, which is exactly what happened before this file existed.
}
