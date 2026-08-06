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
  | { kind: 'search' }
  | { kind: 'page'; title: string }
  | { kind: 'tool'; id: 'dps' | 'calculators' | 'profile' }
  | { kind: 'ge'; itemId?: number }
  | { kind: 'hiscores' }
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
  entries: [{ kind: 'search' }],
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

  reset: (route = { kind: 'search' }) => set({ entries: [route], index: 0 }),
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
  if (a.kind === 'page' && b.kind === 'page') return a.title === b.title
  if (a.kind === 'tool' && b.kind === 'tool') return a.id === b.id
  if (a.kind === 'ge' && b.kind === 'ge') return a.itemId === b.itemId
  return true
}

/** Human-readable label for the top bar. */
export function routeTitle(route: Route): string {
  switch (route.kind) {
    case 'search':
      return 'Search'
    case 'page':
      return route.title
    case 'tool':
      return route.id === 'dps'
        ? 'DPS calculator'
        : route.id === 'calculators'
          ? 'Calculators'
          : 'RuneProfile'
    case 'ge':
      return 'Grand Exchange'
    case 'hiscores':
      return 'Hiscores'
    case 'settings':
      return 'Settings'
  }
}
