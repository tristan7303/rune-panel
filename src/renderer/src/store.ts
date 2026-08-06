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
}

export const useStore = create<State>((set, get) => ({
  settings: null,

  setSettings: (settings) => set({ settings }),

  patchSettings: (patch) => {
    // Applied locally first so a switch does not lag a disk write and an IPC
    // round trip. Main broadcasts the sanitized result, which overwrites this.
    const current = get().settings
    if (current) set({ settings: { ...current, ...patch } })
    window.rb.setSettings(patch)
  },
}))
