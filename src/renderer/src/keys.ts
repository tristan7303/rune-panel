/**
 * In-app keybinds.
 *
 * Distinct from the global hotkey, which is an Electron accelerator registered
 * with the OS and lives in the main process. These only fire while the window
 * has focus, which is why they can be liberal about what they claim — Ctrl+F
 * and Ctrl+G collide with a browser's find and find-next, and there is no
 * browser here to collide with.
 */

/**
 * Parsing lives in shared/keys.ts, because main matches the same specs against
 * the keyboard while an embedded page holds focus.
 *
 * A keybind written the way people write them — "Ctrl+F", "Alt+S" — turned into
 * something comparable against a KeyboardEvent.
 *
 * Deliberately forgiving about separators and case, and deliberately narrow
 * about what counts: a single character or a function key, with any of the
 * three usual modifiers. Anything it cannot parse yields null and the caller
 * falls back, so a mistyped setting loses the shortcut rather than the app.
 */
export { parseCombo, type Combo } from '@shared/keys'

import { parseCombo, type Combo } from '@shared/keys'

export function matches(combo: Combo, e: KeyboardEvent): boolean {
  return (
    combo.ctrl === (e.ctrlKey || e.metaKey) &&
    combo.alt === e.altKey &&
    combo.shift === e.shiftKey &&
    e.key.toLowerCase() === combo.key
  )
}

/** "Ctrl+F" -> "Ctrl F", for the hint chip. */
export function prettyCombo(spec: string): string {
  return spec
    .split(/[+\-\s]+/)
    .filter(Boolean)
    .map((p) => (p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1)))
    .join(' ')
}

/**
 * Subscribe a window-level handler for one configurable bind.
 *
 * Shared so every in-app shortcut behaves the same way: window-level rather
 * than on an element, so it works while the caret is in a text box; and
 * re-subscribed when the setting changes, so a rebind takes effect without a
 * restart.
 */
export function onBind(spec: string, run: (e: KeyboardEvent) => void): () => void {
  const combo = parseCombo(spec)
  if (!combo) return () => {}
  const handler = (e: KeyboardEvent): void => {
    if (!matches(combo, e)) return
    e.preventDefault()
    run(e)
  }
  window.addEventListener('keydown', handler)
  return () => window.removeEventListener('keydown', handler)
}
