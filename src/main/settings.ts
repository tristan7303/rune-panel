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
import { RAIL_IDS, type RailId, type Settings, type Theme, type WindowBounds } from '../shared/ipc'

/** Every theme the stylesheet defines. Anything else falls back to DEFAULTS. */
const THEMES: Theme[] = ['dark', 'mocha', 'light', 'parchment']

export const DEFAULTS: Settings = {
  theme: 'mocha',
  parchmentWorn: false,
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
  showHighAlchInDrops: false,
  // One rule out of the box, because the feature is invisible until it has
  // fired once: "bis" is what gets typed and `/Strategies` is where the answer
  // lives, and no amount of fuzzy matching connects two words with no letters
  // in common.
  keywordAliases: [{ from: 'bis', to: 'strategies' }],
  railOrder: [...RAIL_IDS],
  geTrackerReplacesGe: true,
  startOnLogin: true,
  pluginBridge: true,
  pluginBridgePort: 7737,
  uiScale: 1,
  acrylic: true,
  reduceMotion: false,
  smoothSectionJumps: true,
  hideMetRequirements: false,
  pinContents: false,
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

/** One notch of the interface scale, as the stepper and Ctrl+scroll both use. */
export const SCALE_STEP = 0.05

/**
 * Nudge the interface scale, from wherever the request came.
 *
 * Lives here rather than in either caller because both need it and neither owns
 * it: the settings stepper is in the renderer, and Ctrl+scroll is caught in main
 * on two different web contents. Clamping is `sanitize`'s job, so this can add
 * blindly and let the write decide what is legal — which is also what keeps the
 * floating-point drift of repeated 0.05s from accumulating.
 */
export function bumpScale(direction: 'in' | 'out'): Settings {
  const step = direction === 'in' ? SCALE_STEP : -SCALE_STEP
  return update({ uiScale: current.uiScale + step })
}

export function onChange(listener: (next: Settings) => void): void {
  listeners.add(listener)
}

/** Clamp anything that could wedge the UI if a hand-edited file is wrong. */
function sanitize(s: Settings): Settings {
  return {
    theme: THEMES.includes(s.theme) ? s.theme : DEFAULTS.theme,
    parchmentWorn: Boolean(s.parchmentWorn),
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
    showHighAlchInDrops: Boolean(s.showHighAlchInDrops),
    keywordAliases: sanitizeAliases(s.keywordAliases),
    railOrder: sanitizeRailOrder(s.railOrder),
    // Defaults on, so an absent key means true rather than false.
    geTrackerReplacesGe: s.geTrackerReplacesGe !== false,
    // Defaults on, so an absent key means true rather than false.
    startOnLogin: s.startOnLogin !== false,
    // Defaults on, so an absent key means true rather than false.
    pluginBridge: s.pluginBridge !== false,
    pluginBridgePort: clampPort(s.pluginBridgePort),
    // Clamped rather than trusted: a hand-edited 0.1 would render the window
    // unusable and leave no control big enough to fix it with.
    uiScale: clampScale(s.uiScale),
    acrylic: Boolean(s.acrylic),
    reduceMotion: Boolean(s.reduceMotion),
    // Defaults on, so an absent key means true rather than false.
    smoothSectionJumps: s.smoothSectionJumps !== false,
    hideMetRequirements: Boolean(s.hideMetRequirements),
    pinContents: Boolean(s.pinContents),
    bounds: sanitizeBounds(s.bounds),
  }
}

/**
 * Keeps the interface within the range the settings page itself stays usable
 * in, so a bad value can always be undone from inside the app.
 */
function clampScale(value: unknown): number {
  const scale = typeof value === 'number' && Number.isFinite(value) ? value : 1
  return Math.min(2, Math.max(0.5, Math.round(scale * 100) / 100))
}

/**
 * The plugin bridge's port, kept where an unprivileged process may listen.
 *
 * Anything unusable falls back to the default rather than nearest-legal,
 * because the plugin side defaults to the same number — snapping a typo to
 * 1024 would leave the two silently disagreeing.
 */
function clampPort(value: unknown): number {
  const port = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : NaN
  return port >= 1024 && port <= 65535 ? port : DEFAULTS.pluginBridgePort
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

/**
 * The rail's order, reconciled against what the rail actually has.
 *
 * Two directions to get wrong, and both are silent. An id the app no longer
 * ships is dropped, so a removed entry cannot hold a slot nothing can fill. An
 * id the saved order has never heard of is appended in its shipped position, so
 * an entry added in a later version appears for everyone rather than only for
 * people who have never dragged anything — which is what storing the order
 * verbatim would have done.
 */
function sanitizeRailOrder(value: unknown): RailId[] {
  const known = new Set<string>(RAIL_IDS)
  const seen = new Set<RailId>()
  const out: RailId[] = []

  if (Array.isArray(value)) {
    for (const entry of value) {
      const id = String(entry) as RailId
      if (!known.has(id) || seen.has(id)) continue
      seen.add(id)
      out.push(id)
    }
  }
  for (const id of RAIL_IDS) if (!seen.has(id)) out.push(id)
  return out
}

/** How many synonyms are worth honouring. Past this it is a dictionary. */
const MAX_ALIASES = 40

/**
 * Search synonyms, from a settings file that may have been edited by hand.
 *
 * Deliberately keeps a half-written rule. The editor adds an empty row for you
 * to type into, and every settings change is a round trip through here — so
 * dropping incomplete rules meant the new row was deleted before the first
 * keystroke landed and the Add button did nothing at all. An incomplete rule is
 * not invalid, it is unfinished; the searcher ignores it until it is not.
 *
 * What is enforced is what cannot be typed back out of: both sides are
 * lowercased and length-capped, a `from` cannot be claimed twice, and the list
 * has a ceiling. Spaces are *not* trimmed, and for the same reason incomplete
 * rows are kept: every keystroke round-trips through here, so trimming meant
 * the space you just typed after "best" was gone before "in slot" could follow
 * it. A phrase is a legal rule; the searcher normalises whitespace when it
 * matches, so stray spaces cost nothing.
 */
function sanitizeAliases(value: unknown): Array<{ from: string; to: string }> {
  if (!Array.isArray(value)) return []
  const claimed = new Set<string>()
  const out: Array<{ from: string; to: string }> = []
  // The form that matters for "already claimed" and "maps to itself" — what
  // the searcher will actually compare, not what is mid-keystroke.
  const norm = (s: string): string => s.trim().replace(/\s+/g, ' ')

  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const from = String((entry as { from?: unknown }).from ?? '')
      .toLowerCase()
      .slice(0, 40)
    const to = String((entry as { to?: unknown }).to ?? '')
      .toLowerCase()
      .slice(0, 60)

    // A phrase already spoken for, or one that only maps to itself, is a rule
    // that could never do anything — but only once it is complete enough to
    // judge, so blanks fall through.
    const key = norm(from)
    if (key && (claimed.has(key) || key === norm(to))) continue
    if (key) claimed.add(key)

    out.push({ from, to })
    if (out.length >= MAX_ALIASES) break
  }
  return out
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
