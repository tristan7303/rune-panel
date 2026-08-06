/**
 * The single source of truth for the main <-> renderer boundary.
 *
 * Both sides import these types, so a handler and its caller cannot drift out
 * of sync without the typecheck failing. Channel names live here as consts
 * rather than string literals for the same reason.
 */

export type Theme = 'dark' | 'light'

/** Persisted user settings. */
export interface Settings {
  /** Reading surface. Dark by default — it sits over a dark game client. */
  theme: Theme
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

  /** Show an embedded tool, optionally with an argument. */
  ShowTool: 'tools:show',
  /** Hide the embedded pane. It composites above the DOM, so this is required. */
  HideTool: 'tools:hide',
  /** Tell main where the content area is, in DIP. */
  SetPaneBounds: 'tools:bounds',
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

// ── Embedded tools ──────────────────────────────────────────────────────────

export type ToolId = 'dps' | 'calculators' | 'profile'

/** Content-area rectangle, in DIP relative to the window. */
export interface PaneBounds {
  x: number
  y: number
  width: number
  height: number
}

/** Just enough of a RuneProfile account to decide whether to load the pane. */
export interface ProfileSummary {
  username: string
  exists: boolean
  /** Combined level, when the API reports one. */
  totalLevel?: number
  error?: string
}

// ── Grand Exchange ──────────────────────────────────────────────────────────

export interface GeItem {
  id: number
  name: string
  examine: string | null
  members: boolean
  buyLimit: number | null
  value: number | null
  highalch: number | null
  icon: string | null
}

export interface GePrice {
  itemId: number
  /** Instant-buy: what someone just paid. */
  high: number | null
  highTime: number | null
  /** Instant-sell: what someone just accepted. */
  low: number | null
  lowTime: number | null
  updatedAt: number
}

export interface GeSeriesPoint {
  ts: number
  avgHigh: number | null
  avgLow: number | null
  volHigh: number
  volLow: number
}

export interface GeItemDetail {
  item: GeItem
  price: GePrice | null
  /** Buy minus sell, before the 2% sell tax. */
  margin: number | null
  potentialProfit: number | null
  series: GeSeriesPoint[]
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
  LookupProfile: 'profile:lookup',
  GeDetail: 'ge:detail',
  GeFindByName: 'ge:find',
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

/** The surface exposed on `window.rp` by the preload script. */
export interface RunePanelApi {
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

  showTool(id: ToolId, arg?: string): void
  hideTool(): void
  setPaneBounds(bounds: PaneBounds): void
  lookupProfile(username: string): Promise<ProfileSummary>

  geDetail(itemId: number): Promise<GeItemDetail | null>
  geFindByName(name: string): Promise<GeItem | null>

  onShown(cb: () => void): () => void
  onSettings(cb: (settings: Settings) => void): () => void
  onSyncProgress(cb: (progress: SyncProgress) => void): () => void
  onCrawlProgress(cb: (state: CrawlState) => void): () => void
}

declare global {
  interface Window {
    rp: RunePanelApi
  }
}
