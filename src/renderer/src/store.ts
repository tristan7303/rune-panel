/**
 * Renderer state.
 *
 * Deliberately thin for now. Navigation history and the route union land in
 * phase 2 — this only tracks which top-level view is showing and mirrors the
 * settings main owns, so the shell has something real to render against.
 */

import { create } from 'zustand'
import type { Settings } from '@shared/ipc'

export type View =
  | 'search'
  | 'wiki'
  | 'dps'
  | 'ge'
  | 'hiscores'
  | 'profile'
  | 'calculators'
  | 'settings'

interface State {
  view: View
  settings: Settings | null
  setView: (view: View) => void
  setSettings: (settings: Settings) => void
  /** Patch settings optimistically and push the change to main. */
  patchSettings: (patch: Partial<Settings>) => void
}

export const useStore = create<State>((set, get) => ({
  view: 'search',
  settings: null,

  setView: (view) => set({ view }),
  setSettings: (settings) => set({ settings }),

  patchSettings: (patch) => {
    // Applied locally first so a switch does not lag a disk write and an IPC
    // round trip. Main broadcasts the sanitized result, which overwrites this.
    const current = get().settings
    if (current) set({ settings: { ...current, ...patch } })
    window.rb.setSettings(patch)
  },
}))
