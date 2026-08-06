/**
 * The single source of truth for the main <-> renderer boundary.
 *
 * Both sides import these types, so a handler and its caller cannot drift out
 * of sync without the typecheck failing. Channel names live here as consts
 * rather than string literals for the same reason.
 */

/** Persisted user settings. */
export interface Settings {
  /** Global accelerator that opens and closes the window. */
  hotkey: string
  /** Close the window as soon as it loses focus. Off by default: you will click
   *  into the game while reading, and vanishing mid-sentence is worse than an
   *  extra Escape. */
  hideOnBlur: boolean
  /**
   * Contact string appended to the outgoing User-Agent. The OSRS Wiki asks
   * automated clients to identify themselves and say how to reach the author;
   * empty is tolerated but rude, so the settings sheet nags for it once.
   */
  contactEmail: string
  /**
   * Draw the Windows 11 DWM acrylic backdrop behind the window. Turn off if the
   * blur costs frames or the compositor refuses it. The UI is designed to look
   * correct either way — acrylic is an accent, never load-bearing.
   */
  acrylic: boolean
  /** Last window bounds, restored on next launch. Null until first move/resize. */
  bounds: WindowBounds | null
}

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

/** Default window size. Wide enough for an article plus its infobox. */
export const WINDOW = {
  width: 1180,
  height: 820,
  minWidth: 900,
  minHeight: 600,
} as const

/** Renderer -> main, fire and forget. */
export const Send = {
  /** Close the window. Escape, or the close control. */
  Hide: 'window:hide',
  Log: 'app:log',
  Quit: 'app:quit',
  /** Persist a settings change. */
  SetSettings: 'settings:set',
} as const

/** Renderer -> main, awaits a reply. */
export const Invoke = {
  GetSettings: 'settings:get',
} as const

/** Main -> renderer. */
export const On = {
  /**
   * The window just became visible — via hotkey, tray, or a second launch.
   * The renderer resets to the search view and focuses the input; main
   * deliberately does not decide what "opening" means beyond showing pixels.
   */
  Shown: 'window:shown',
  /** Settings changed. */
  Settings: 'settings:changed',
} as const

/** The surface exposed on `window.rb` by the preload script. */
export interface RuneBuddyApi {
  hide(): void
  log(message: string): void
  quit(): void

  getSettings(): Promise<Settings>
  setSettings(patch: Partial<Settings>): void

  onShown(cb: () => void): () => void
  onSettings(cb: (settings: Settings) => void): () => void
}

declare global {
  interface Window {
    rb: RuneBuddyApi
  }
}
