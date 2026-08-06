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

// ── Wiki title index ────────────────────────────────────────────────────────

export type SyncPhase = 'idle' | 'articles' | 'redirects' | 'targets' | 'writing' | 'done' | 'error'

export interface SyncProgress {
  phase: SyncPhase
  /** Titles seen so far across every phase. */
  fetched: number
  /** API requests this run has made, including retries. */
  requests: number
  message?: string
}

export interface TitleIndexState {
  count: number
  redirects: number
  /** Epoch ms of the last successful sync, or null if never. */
  syncedAt: number | null
  syncing: boolean
  progress: SyncProgress
}

/** Renderer -> main, fire and forget. */
export const Send = {
  /** Close the window. Escape, or the close control. */
  Hide: 'window:hide',
  Log: 'app:log',
  Quit: 'app:quit',
  /** Persist a settings change. */
  SetSettings: 'settings:set',
  /** Rebuild the wiki title index. No-op if one is already running. */
  SyncTitles: 'wiki:sync-titles',
  /** Warm the cache for a title the cursor is resting on. */
  PrefetchPage: 'wiki:prefetch',
  /** Start the background refresh + crawl. No-op if already running. */
  StartCrawl: 'wiki:crawl-start',
  /** Ask the crawler to stop after the current page. */
  StopCrawl: 'wiki:crawl-stop',
} as const

export interface SearchResult {
  /** The canonical article to navigate to. */
  title: string
  /** The alias that actually matched, when it differs from `title`. */
  matchedVia?: string
}

// ── Articles ────────────────────────────────────────────────────────────────

export interface InfoboxRow {
  label: string
  /** Already-transformed HTML: values carry links and item icons worth keeping. */
  value: string
}

export interface Infobox {
  header?: string
  image?: string
  rows: InfoboxRow[]
}

export interface Section {
  level: number
  line: string
  anchor: string
}

export type CrawlPhase = 'idle' | 'refreshing' | 'crawling' | 'paused' | 'done' | 'error'

export interface CrawlState {
  phase: CrawlPhase
  /** Pages fetched this run. */
  done: number
  /** Pages still queued. */
  remaining: number
  /** Pages held in the cache, total. */
  cached: number
  /** Pages known to be out of date. */
  stale: number
  message?: string
}

export interface Article {
  title: string
  revid: number
  html: string
  infobox: Infobox | null
  sections: Section[]
  categories: string[]
  fetchedAt: number
  /** True when served from disk without touching the network. */
  cached: boolean
  /** Marked out of date by a recentchanges sweep; content is still shown. */
  stale: boolean
}

/** Renderer -> main, awaits a reply. */
export const Invoke = {
  GetSettings: 'settings:get',
  GetTitleIndex: 'wiki:title-index',
  Search: 'wiki:search',
  GetPage: 'wiki:page',
  GetCrawlState: 'wiki:crawl-state',
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
  /** One step of a title-index sync. */
  SyncProgress: 'wiki:sync-progress',
  /** One step of the background refresh + crawl. */
  CrawlProgress: 'wiki:crawl-progress',
} as const

/** The surface exposed on `window.rb` by the preload script. */
export interface RuneBuddyApi {
  hide(): void
  log(message: string): void
  quit(): void

  getSettings(): Promise<Settings>
  setSettings(patch: Partial<Settings>): void

  getTitleIndex(): Promise<TitleIndexState>
  syncTitles(): void
  search(query: string): Promise<SearchResult[]>
  getPage(title: string, options?: { force?: boolean }): Promise<Article | null>
  prefetchPage(title: string): void

  getCrawlState(): Promise<CrawlState>
  startCrawl(): void
  stopCrawl(): void

  onShown(cb: () => void): () => void
  onSettings(cb: (settings: Settings) => void): () => void
  onSyncProgress(cb: (progress: SyncProgress) => void): () => void
  onCrawlProgress(cb: (state: CrawlState) => void): () => void
}

declare global {
  interface Window {
    rb: RuneBuddyApi
  }
}
