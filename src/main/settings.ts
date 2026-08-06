/**
 * Persisted user settings.
 *
 * Stored under the OS user-data directory rather than beside the source, so a
 * rebuild or reinstall does not wipe them and nothing personal lands in the
 * repo. Unknown or malformed files fall back to defaults instead of failing to
 * start — a corrupt settings file should never cost you the app.
 */

import { app } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { Settings, WindowBounds } from '../shared/ipc'

export const DEFAULTS: Settings = {
  theme: 'dark',
  // Global accelerators are first-come-first-served: whichever app registers
  // first wins, and the loser gets no hotkey at all with only a console warning
  // to say so. Nothing else on this machine should claim this one.
  hotkey: 'Control+Shift+Space',
  hideOnBlur: false,
  contactEmail: '',
  acrylic: true,
  bounds: null,
}

let current: Settings = { ...DEFAULTS }
const listeners = new Set<(next: Settings) => void>()

function file(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function load(): Settings {
  try {
    const raw = JSON.parse(readFileSync(file(), 'utf8')) as Partial<Settings>
    // Merge over defaults so a file written by an older build, missing keys
    // added since, still produces a complete object.
    current = sanitize({ ...DEFAULTS, ...raw })
  } catch {
    current = { ...DEFAULTS }
  }
  return current
}

export function get(): Settings {
  return { ...current }
}

export function update(patch: Partial<Settings>): Settings {
  current = sanitize({ ...current, ...patch })
  try {
    writeFileSync(file(), JSON.stringify(current, null, 2))
  } catch (err) {
    console.warn('[settings] could not save:', err instanceof Error ? err.message : err)
  }
  for (const listener of listeners) listener(get())
  return get()
}

export function onChange(listener: (next: Settings) => void): void {
  listeners.add(listener)
}

/** Clamp anything that could wedge the UI if a hand-edited file is wrong. */
function sanitize(s: Settings): Settings {
  return {
    theme: s.theme === 'light' || s.theme === 'parchment' ? s.theme : 'dark',
    hotkey: typeof s.hotkey === 'string' && s.hotkey.trim() ? s.hotkey.trim() : DEFAULTS.hotkey,
    hideOnBlur: Boolean(s.hideOnBlur),
    contactEmail: typeof s.contactEmail === 'string' ? s.contactEmail.trim().slice(0, 200) : '',
    acrylic: Boolean(s.acrylic),
    bounds: sanitizeBounds(s.bounds),
  }
}

function sanitizeBounds(b: WindowBounds | null): WindowBounds | null {
  if (!b || typeof b !== 'object') return null
  const values = [b.x, b.y, b.width, b.height]
  if (!values.every((v) => typeof v === 'number' && Number.isFinite(v))) return null
  // Position is validated against the actual displays at launch (see
  // window.ts); only the size needs a floor here.
  return {
    x: Math.round(b.x),
    y: Math.round(b.y),
    width: Math.max(Math.round(b.width), 320),
    height: Math.max(Math.round(b.height), 240),
  }
}
