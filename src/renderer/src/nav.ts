/**
 * Navigation history.
 *
 * A hand-written stack rather than a router. Everything a router brings —
 * URL parsing, route matching, code splitting, a Link component — is dead
 * weight in a single-window desktop app with a closed set of destinations, and
 * a tagged union gives type-safe routes that string paths cannot.
 *
 * The model is a browser's: a linear list plus a cursor. Navigating from the
 * middle truncates the forward entries, which is what makes back/forward behave
 * the way muscle memory expects.
 */

import { create } from 'zustand'

export type Route =
  | { kind: 'home' }
  /**
   * `hash` is a section anchor to land on rather than the top of the page —
   * how a drop badge opens its source *at* the loot table, and what a wiki link
   * carrying a `#fragment` has always meant but nothing here could act on.
   */
  | { kind: 'page'; title: string; hash?: string }
  /**
   * `arg` is whatever the tool needs to open on something specific — for GE
   * Tracker, the item name to look up. Routing it rather than holding it in the
   * view means "Price history" on an article can land on the item directly, and
   * that going back returns to whatever was showing before.
   */
  | { kind: 'tool'; id: 'dps' | 'calculators' | 'profile' | 'getracker'; arg?: string }
  | { kind: 'ge'; itemId?: number }
  | { kind: 'hiscores' }
  /**
   * `id` is the note to open. Absent means "whatever was open last, or the
   * first one" — routing the choice rather than holding it in the view is what
   * lets Back step between notes the way it steps between articles.
   */
  | { kind: 'notes'; id?: number }
  | { kind: 'settings' }

/** Cap on retained history. Deep enough to never be felt, bounded so a long
 *  session cannot grow it without limit. */
const MAX_ENTRIES = 200

interface NavState {
  entries: Route[]
  index: number
  push: (route: Route) => void
  replace: (route: Route) => void
  back: () => void
  forward: () => void
  reset: (route?: Route) => void
}

export const useNav = create<NavState>((set, get) => ({
  entries: [{ kind: 'home' }],
  index: 0,

  push: (route) => {
    const { entries, index } = get()

    // Re-navigating to where you already are should not stack a duplicate:
    // otherwise Back appears broken, silently consuming a press per repeat.
    if (sameRoute(entries[index], route)) return

    const next = [...entries.slice(0, index + 1), route]
    const overflow = Math.max(0, next.length - MAX_ENTRIES)
    set({ entries: next.slice(overflow), index: next.length - 1 - overflow })
  },

  replace: (route) => {
    const next = [...get().entries]
    next[get().index] = route
    set({ entries: next })
  },

  back: () => {
    const { index } = get()
    if (index > 0) set({ index: index - 1 })
  },

  forward: () => {
    const { entries, index } = get()
    if (index < entries.length - 1) set({ index: index + 1 })
  },

  reset: (route = { kind: 'home' }) => set({ entries: [route], index: 0 }),
}))

// Exposed so the SMOKE_SHOT capture can navigate the way a click does, instead
// of synthesising global keystrokes that land in whatever window has focus.
;(window as unknown as { __rpNav: typeof useNav }).__rpNav = useNav

/** The route currently displayed. */
export function useRoute(): Route {
  return useNav((s) => s.entries[s.index])
}

export function useCanGoBack(): boolean {
  return useNav((s) => s.index > 0)
}

export function useCanGoForward(): boolean {
  return useNav((s) => s.index < s.entries.length - 1)
}

function sameRoute(a: Route | undefined, b: Route): boolean {
  if (!a || a.kind !== b.kind) return false
  // The hash counts: jumping to a section of the page you are already on is a
  // real navigation, and treating it as a no-op would make a badge on the
  // source's own page do nothing.
  if (a.kind === 'page' && b.kind === 'page') return a.title === b.title && a.hash === b.hash
  if (a.kind === 'tool' && b.kind === 'tool') return a.id === b.id && a.arg === b.arg
  if (a.kind === 'ge' && b.kind === 'ge') return a.itemId === b.itemId
  if (a.kind === 'notes' && b.kind === 'notes') return a.id === b.id
  return true
}

/** A map rather than a nested ternary — the chain got a fourth arm. */
const TOOL_TITLES: Record<'dps' | 'calculators' | 'profile' | 'getracker', string> = {
  dps: 'DPS calculator',
  calculators: 'Calculators',
  profile: 'RuneProfile',
  getracker: 'GE Tracker',
}

/** Human-readable label for the top bar. */
export function routeTitle(route: Route): string {
  switch (route.kind) {
    case 'home':
      return 'Rune Panel'
    case 'page':
      return route.title
    case 'tool':
      return TOOL_TITLES[route.id]
    case 'ge':
      return 'Grand Exchange'
    case 'hiscores':
      return 'Hiscores'
    case 'notes':
      return 'Notes'
    case 'settings':
      return 'Settings'
  }
}
