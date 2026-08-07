/**
 * Keybind specs, parsed once for both processes.
 *
 * The renderer matches these against DOM `KeyboardEvent`s; main matches the
 * same specs against Electron's `Input` objects, so that a shortcut still works
 * while the keyboard belongs to an embedded page. One parser, so the two cannot
 * disagree about what "Ctrl+F" means.
 */

export interface Combo {
  ctrl: boolean
  alt: boolean
  shift: boolean
  key: string
}

export function parseCombo(spec: string): Combo | null {
  const parts = spec
    .split(/[+\-\s]+/)
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean)
  if (parts.length === 0) return null

  const combo: Combo = { ctrl: false, alt: false, shift: false, key: '' }
  for (const part of parts) {
    if (part === 'ctrl' || part === 'control' || part === 'cmd' || part === 'meta') combo.ctrl = true
    else if (part === 'alt' || part === 'option') combo.alt = true
    else if (part === 'shift') combo.shift = true
    else combo.key = part
  }
  if (!combo.key || (combo.key.length > 1 && !/^f\d{1,2}$/.test(combo.key))) return null
  return combo
}
