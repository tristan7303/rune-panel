/**
 * The only way this app hands a URL to the operating system.
 *
 * `shell.openExternal` launches whatever Windows has registered for a scheme,
 * which is a great deal more than a browser. `file:///C:/…` opens local files
 * and executables; `ms-msdt:`, `search-ms:` and friends have all been used as
 * attack vectors. Handing one an unchecked URL is the difference between
 * "opens a link" and "runs a program".
 *
 * Only http and https get through. That is every link anyone legitimately
 * clicks here — wiki articles, the DPS calculator, RuneProfile — and it costs
 * nothing to refuse the rest.
 *
 * This matters most for the embedded tool pane, which renders third-party pages
 * that can call `window.open` with whatever they like, including from an ad
 * script the site itself did not write.
 */

import { shell } from 'electron'

const ALLOWED = new Set(['http:', 'https:'])

export function openExternal(url: string): void {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    console.warn(`[open] refused unparseable url: ${url.slice(0, 120)}`)
    return
  }

  if (!ALLOWED.has(parsed.protocol)) {
    console.warn(`[open] refused ${parsed.protocol} url: ${url.slice(0, 120)}`)
    return
  }

  void shell.openExternal(parsed.toString())
}
