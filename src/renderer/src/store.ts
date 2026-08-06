/**
 * Renderer state that is not navigation.
 *
 * Where you are lives in nav.ts; this is the mirror of what main owns.
 */

import { create } from 'zustand'
import type { Settings } from '@shared/ipc'

interface State {
  settings: Settings | null
  setSettings: (settings: Settings) => void
  /** Patch settings optimistically and push the change to main. */
  patchSettings: (patch: Partial<Settings>) => void

  /**
   * How many overlays are open — the theme menu, the search results.
   *
   * An embedded tool is a WebContentsView, which composites *above* the DOM
   * and cannot be layered under anything. Any panel that opens over the content
   * area is therefore invisible while a tool is showing, so the pane has to be
   * hidden for the duration. A counter rather than a boolean because two can
   * overlap — searching with the theme menu open — and the first to close must
   * not bring the pane back over the second.
   */
  overlays: number
  pushOverlay: () => void
  popOverlay: () => void

  /**
   * Where the open overlay is, in window coordinates.
   *
   * The pane cannot be layered under it, so it is moved out of the way
   * instead — which requires knowing what to move out of the way of.
   */
  overlayRect: DOMRectLike | null
  setOverlayRect: (rect: DOMRectLike | null) => void
}

export interface DOMRectLike {
  x: number
  y: number
  width: number
  height: number
}

export const useStore = create<State>((set, get) => ({
  settings: null,
  overlays: 0,
  overlayRect: null,

  pushOverlay: () => set((s) => ({ overlays: s.overlays + 1 })),
  popOverlay: () =>
    set((s) => {
      const next = Math.max(0, s.overlays - 1)
      return { overlays: next, overlayRect: next === 0 ? null : s.overlayRect }
    }),
  setOverlayRect: (overlayRect) => set({ overlayRect }),

  setSettings: (settings) => set({ settings }),

  patchSettings: (patch) => {
    // Applied locally first so a switch does not lag a disk write and an IPC
    // round trip. Main broadcasts the sanitized result, which overwrites this.
    const current = get().settings
    if (current) set({ settings: { ...current, ...patch } })
    window.rp.setSettings(patch)
  },
}))

// Exposed for the smoke suite, which drives overlays through the real store
// rather than synthesising clicks on a menu that may not be on screen.
;(window as unknown as { __rpStore: typeof useStore }).__rpStore = useStore
