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
import type { Settings, Theme, WindowBounds } from '../shared/ipc'

/** Every theme the stylesheet defines. Anything else falls back to dark. */
const THEMES: Theme[] = ['dark', 'mocha', 'light', 'parchment']

export const DEFAULTS: Settings = {
  theme: 'dark',
  // Global accelerators are first-come-first-served: whichever app registers
  // first wins, and the loser gets no hotkey at all with only a console warning
  // to say so. Nothing else on this machine should claim this one.
  hotkey: 'Control+Shift+Space',
  searchKey: 'Ctrl+F',
  geKey: 'Ctrl+G',
  alwaysOnTop: true,
  hideOnBlur: false,
  contactEmail: '',
  rsn: '',
  dropRateInTitle: false,
  dropRateOrder: 'common',
  normaliseDropRates: false,
  geTrackerReplacesGe: true,
  startOnLogin: true,
  acrylic: true,
  reduceMotion: false,
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
    theme: THEMES.includes(s.theme) ? s.theme : 'dark',
    hotkey: typeof s.hotkey === 'string' && s.hotkey.trim() ? s.hotkey.trim() : DEFAULTS.hotkey,
    searchKey: bind(s.searchKey, DEFAULTS.searchKey),
    geKey: bind(s.geKey, DEFAULTS.geKey),
    alwaysOnTop: s.alwaysOnTop !== false,
    hideOnBlur: Boolean(s.hideOnBlur),
    contactEmail: typeof s.contactEmail === 'string' ? s.contactEmail.trim().slice(0, 200) : '',
    // Jagex caps a display name at 12 characters, so anything longer is a
    // mistake rather than a name and truncating it costs nothing real.
    rsn: typeof s.rsn === 'string' ? s.rsn.trim().slice(0, 12) : '',
    dropRateInTitle: Boolean(s.dropRateInTitle),
    dropRateOrder: s.dropRateOrder === 'rare' ? 'rare' : 'common',
    normaliseDropRates: Boolean(s.normaliseDropRates),
    // Defaults on, so an absent key means true rather than false.
    geTrackerReplacesGe: s.geTrackerReplacesGe !== false,
    // Defaults on, so an absent key means true rather than false.
    startOnLogin: s.startOnLogin !== false,
    acrylic: Boolean(s.acrylic),
    reduceMotion: Boolean(s.reduceMotion),
    bounds: sanitizeBounds(s.bounds),
  }
}

/**
 * An in-app keybind string.
 *
 * Length-capped rather than parsed: the renderer is the only thing that reads
 * these and it already treats anything it cannot understand as "no shortcut".
 * Validating the syntax in two places invites the two from disagreeing.
 */
function bind(value: string, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 40) : fallback
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
