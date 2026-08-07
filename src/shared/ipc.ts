/**
 * The single source of truth for the main <-> renderer boundary.
 *
 * Both sides import these types, so a handler and its caller cannot drift out
 * of sync without the typecheck failing. Channel names live here as consts
 * rather than string literals for the same reason.
 */

/**
 * Three reading surfaces. Parchment is the default: a warm tan that suits a
 * fantasy wiki and is easier on the eyes than plain white for long articles.
 */
export type Theme = 'dark' | 'mocha' | 'light' | 'parchment'

/** Persisted user settings. */
export interface Settings {
  /** Reading surface. Dark by default — it sits over a dark game client. */
  theme: Theme
  /** Global accelerator that opens and closes the window. */
  hotkey: string
  /**
   * Focuses the wiki search box. In-app only, so it needs no global
   * registration and cannot collide with another program's shortcut.
   */
  searchKey: string
  /**
   * Jumps to the Grand Exchange and focuses its item box — or just focuses it,
   * if you are already there. In-app only, like `searchKey`.
   */
  geKey: string
  /**
   * Keep the window above other windows while it is open. On by default: it is
   * meant to be read beside a game client.
   */
  alwaysOnTop: boolean
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
   * Your RuneScape display name.
   *
   * Read-only use: it identifies which hiscores account to check skill
   * requirements against, and prefills the hiscores and profile lookups. Empty
   * means the feature is simply off — nothing is sent anywhere until a name is
   * here, and the hiscores are public either way.
   */
  rsn: string
  /**
   * Show an item's drop rates beside its title.
   *
   * Read off the page's own sources table: up to three coloured rates, or a
   * single "Multiple sources" chip past that. Off by default — it is a useful
   * answer on a boss drop and pure noise on a bucket of sand.
   */
  dropRateInTitle: boolean
  /** Which end of the ramp those badges start from. */
  dropRateOrder: 'common' | 'rare'
  /**
   * Rewrite every drop rate as 1-in-N, including inside drop tables.
   *
   * Off by default, because `5/150` says the drop occupies five slots of a
   * hundred and fifty, which is how it is actually implemented — worth keeping
   * unless you would rather compare odds at a glance. The title badges are
   * always normalised regardless; that is the whole point of them.
   */
  normaliseDropRates: boolean
  /**
   * Prefer GE Tracker over the built-in Grand Exchange, everywhere.
   *
   * One switch rather than several, because half-applying it is the confusing
   * state: the rail entry, the Ctrl+G shortcut and every "Price history" button
   * all move together, and the Grand Exchange entry leaves the rail rather than
   * sitting beside a page that has replaced it.
   *
   * On by default. GE Tracker has margins, volume and a longer history than the
   * built-in chart, which is the reason to have embedded it at all — but the
   * built-in one is still there, still offline and instant, for anyone who turns
   * this off.
   */
  geTrackerReplacesGe: boolean
  /**
   * Start with Windows, hidden.
   *
   * On by default, because the panel is summoned by a hotkey and a hotkey that
   * only works once you have remembered to launch something is not a hotkey.
   * Hidden is the whole point: it registers the shortcut and waits in the tray
   * rather than opening a window at you every time you log in.
   */
  startOnLogin: boolean
  /**
   * How large the interface is drawn, as a multiplier.
   *
   * The whole renderer, not a font size — this app measures in pixels
   * throughout, so scaling type alone would leave every icon, rail and rule
   * where it was. Applied as the renderer's zoom factor, which scales layout
   * and text together and costs nothing to change.
   *
   * Clamped to a range that keeps the window usable at its minimum size: much
   * below 0.8 the rail icons stop being hittable, much above 1.5 the topbar
   * controls start colliding at 900px wide.
   */
  uiScale: number
  /**
   * Draw the Windows 11 DWM acrylic backdrop behind the window. Turn off if the
   * blur costs frames or the compositor refuses it. The UI is designed to look
   * correct either way — acrylic is an accent, never load-bearing.
   */
  acrylic: boolean
  /**
   * Replace the open/close animation with a plain fade.
   *
   * Off by default. Independent of the OS `prefers-reduced-motion` setting,
   * which forces the same thing — this is for people who simply want the panel
   * to appear rather than arrive.
   */
  reduceMotion: boolean
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

/**
 * The open/close animation, shared because both processes animate half of it.
 *
 * Main walks the real window rectangle and its opacity; the renderer scales
 * `#root` to match, so the content rides the frame instead of reflowing inside
 * it. The renderer runs deliberately faster on the way in and slower on the way
 * out, keeping its content fractionally larger than the window clipping it.
 * See `main/anim.ts`.
 */
export const MOTION = {
  /**
   * Opening: grow from `enter` up to full, decelerating.
   *
   * A short travel is right here. The window arrives already recognisable and
   * settles, which is what makes a summoned panel feel immediate rather than
   * animated at you.
   */
  enter: 0.85,
  enterDuration: 150,

  /**
   * Closing: shrink to `exit` on a smoothstep, fading out as it goes.
   *
   * These numbers are the answer to "why is the close jagged", and they are
   * smaller than they look like they should be.
   *
   * The window is resized by the main process, one `setBounds` per timer tick,
   * so the animation is genuinely stepped in a way a compositor transition is
   * not. What the eye reads as jagged is simply the size of one step. An
   * accelerating close to 28% put its largest steps at the very end — 258px of
   * width in a single frame on a 1400px window, measured. A smoothstep to 70%
   * peaks at 49px.
   *
   * Losing most of the travel costs nothing, because opacity is what actually
   * makes the window disappear and it runs in parallel: by the time the window
   * has faded to a tenth, the old curve had only shrunk it to 75% anyway. The
   * rest of that 72% travel happened behind an invisible window. All it ever
   * contributed was the jitter.
   *
   * Smoothstep rather than an ease-in for the same reason — it has the lowest
   * peak velocity of the curves that still finish decisively. The instant
   * feedback that an ease-in was there to provide comes from the fade instead,
   * which starts moving on the first frame.
   */
  exit: 0.7,
  exitDuration: 210,

  /**
   * How much larger than the window the renderer's content is asked to be.
   *
   * The window steps on a main-process timer and the content glides on a
   * compositor transition — two clocks that cannot be held in sync to better
   * than a frame. A frame of skew in one direction crops the content, which is
   * invisible; in the other it opens a strip of bare desktop along the window
   * edge, which very much is not. Scaling the content a few percent large makes
   * the second impossible.
   *
   * Free at the end of a close, where the window is fully transparent by the
   * time the difference is at its largest.
   */
  slack: 1.05,

  /**
   * The reduced-motion alternative: opacity only, no geometry at all.
   *
   * Short, because a fade has nothing to look at. Anything slower than this
   * reads as the window struggling to appear.
   */
  fadeDuration: 90,

  /**
   * Requested step interval for the main-side rectangle walk.
   *
   * Eight, not sixteen, and not because anyone wants 120fps. Windows ticks its
   * timers every 15.6ms, so `setTimeout(…, 16)` does not fire at 16ms — it
   * misses the tick it was aiming for and lands on the next one at ~31ms, which
   * is 32fps and visibly steppy. Asking for 8 lands on the very next tick.
   * Measured: 31ms gaps at `frame: 16`, 15-16ms gaps at `frame: 8`.
   */
  frame: 8,
} as const

/**
 * How the window comes and goes.
 *
 * `scale` is the real thing. `fade` is opacity only, for reduced motion —
 * chosen over doing nothing because a fade is not motion, and something is
 * easier to follow than an instant appearance. `none` is the smoke suite, which
 * asserts window state and should not have to wait for a curve.
 */
export type MotionMode = 'scale' | 'fade' | 'none'

export interface MotionEvent {
  phase: 'open' | 'close'
  /** Only `scale` asks anything of the renderer; the others are main's alone. */
  mode: MotionMode
  /** The full-size rectangle, so the renderer can freeze its layout at it. */
  width: number
  height: number
}

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
  /**
   * The renderer reporting `prefers-reduced-motion`. Main cannot read a media
   * query, and it owns half the open/close animation, so it has to be told.
   */
  ReduceMotion: 'window:reduce-motion',
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

  /** Begin the first-run download. */
  RunSetup: 'setup:run',
  /** Check, download or install an update. */
  UpdateCheck: 'update:check',
  UpdateDownload: 'update:download',
  UpdateInstall: 'update:install',

  /** Show an embedded tool, optionally with an argument. */
  ShowTool: 'tools:show',
  /** Hide the embedded pane. It composites above the DOM, so this is required. */
  HideTool: 'tools:hide',
  /** Tell main where the content area is, in DIP. */
  /**
   * Synchronous, and asked by the tools' preload before the page paints.
   * Answers with the CSS for the tool being shown. See src/preload/pane.ts.
   */
  PaneThemeCss: 'tools:theme-css',
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
  /** Per-variant values, parallel to `Infobox.variants`. */
  byVariant?: Array<string | null>
}

/**
 * One form of the subject: Vorkath awake, Vorkath asleep.
 *
 * A form can itself have variants, so the card carries two levels of tabs —
 * Vorkath's awake statblock also has post-quest and Dragon Slayer II versions.
 */
export interface InfoboxForm {
  /** Tab label — "Awakened", "Active", "Idle". */
  label: string
  header?: string
  headerByVariant?: Array<string | null>
  image?: string
  imageByVariant?: Array<string | null>
  rows: InfoboxRow[]
  /** "Uncharged", "Charged" — empty for a form with nothing to switch. */
  variants: string[]
  defaultVariant: number
}

export interface Infobox {
  /** Always at least one; more than one only when the page describes forms. */
  forms: InfoboxForm[]
  defaultForm: number
}

export interface Section {
  level: number
  line: string
  anchor: string
}

// ── Embedded tools ──────────────────────────────────────────────────────────

export type ToolId = 'dps' | 'calculators' | 'profile' | 'getracker'

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
  totalXp?: number
  /** "Ironman", "Hardcore Ironman", … */
  accountType?: string
  clan?: string
  questsCompleted?: number
  questsTotal?: number
  collectionObtained?: number
  collectionTotal?: number
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

export type GeTimestep = '5m' | '1h' | '6h' | '24h'

export interface GeItemDetail {
  item: GeItem
  price: GePrice | null
  /** Buy minus sell, before the 2% sell tax. */
  margin: number | null
  potentialProfit: number | null
  series: GeSeriesPoint[]
}

// ── Hiscores ────────────────────────────────────────────────────────────────

export type AccountMode = 'main' | 'ironman' | 'hardcore' | 'ultimate'

export interface XpProgress {
  level: number
  virtualLevel: number
  toNextLevel: number | null
  fraction: number
  toMax: number | null
}

export interface HiscoreSkill {
  id: number
  name: string
  /** -1 when unranked. */
  rank: number
  level: number
  xp: number
  progress: XpProgress
}

export interface HiscoreActivity {
  id: number
  name: string
  rank: number
  score: number
}

export interface Hiscores {
  name: string
  mode: AccountMode
  skills: HiscoreSkill[]
  activities: HiscoreActivity[]
  totalLevel: number
  totalXp: number
  overallRank: number
  fetchedAt: number
  /**
   * Other boards this name is listed on, most restrictive first.
   *
   * Non-empty means the account has changed type: a dead hardcore ironman is
   * still on the hardcore board, frozen, and a de-ironed account is still on the
   * ironman one. `mode` above is whichever board is still being written to.
   */
  alsoOn: AccountMode[]
}

// ── First run and updates ───────────────────────────────────────────────────

export type SetupStep = 'titles' | 'prices' | 'done'

export interface SetupProgress {
  step: SetupStep
  /** 0-100 across the whole run, weighted by how long each step takes. */
  percent: number
  detail: string
  running: boolean
  done: boolean
  error?: boolean
}

export type UpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'current'
  | 'error'
  /** Development build: there is nothing to replace. */
  | 'unsupported'

export interface UpdateStatus {
  state: UpdateState
  /** The version being offered, downloaded or installed. Null when there is none. */
  version: string | null
  /** The version running right now. Constant for the session. */
  currentVersion: string
  /** Download percentage, 0-100. */
  progress: number
  message?: string
}

/** Which app shortcut was pressed inside an embedded pane. */
export type PaneShortcut = 'search' | 'ge'

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
  /** Current prices for several items at once, for the GE Tracker watchlist. */
  GePrices: 'ge:prices',
  Hiscores: 'hiscores:lookup',
  /**
   * A still of the pane as it looks right now, as a data URL — or null when
   * nothing is showing. Taken just before the pane stands down for an overlay,
   * so what the eye sees is the page staying put with a dropdown over it.
   */
  CapturePane: 'tools:capture',
  GetSetup: 'setup:state',
  GetUpdate: 'update:state',
} as const

/** Main -> renderer. */
export const On = {
  /**
   * The window just became visible — via hotkey, tray, or a second launch.
   * The renderer resets to the search view and focuses the input; main
   * deliberately does not decide what "opening" means beyond showing pixels.
   */
  Shown: 'window:shown',
  /**
   * Run the renderer's half of the open/close animation. Sent immediately
   * before main starts walking the window rectangle, so the two move together.
   */
  Motion: 'window:motion',
  /** Settings changed. */
  Settings: 'settings:changed',
  /** One step of a title-index sync. */
  SyncProgress: 'wiki:sync-progress',
  SetupProgress: 'setup:progress',
  UpdateStatus: 'update:status',
  /** One step of the background refresh + crawl. */
  CrawlProgress: 'wiki:crawl-progress',
  /**
   * The pane is mid-navigation, or has finished. It is deliberately not shown
   * until its page is loaded and themed, so the renderer fills the gap.
   */
  PaneLoading: 'tools:loading',
  /**
   * An in-app shortcut pressed while an embedded tool had the keyboard.
   *
   * The renderer's own key listeners are on its document, and a
   * `WebContentsView` is a different one — so with a pane focused, Ctrl+F and
   * Ctrl+G reached the website and nothing else. Main watches the pane's input
   * and forwards the ones that belong to the app.
   */
  PaneShortcut: 'tools:shortcut',
} as const

/** The surface exposed on `window.rp` by the preload script. */
export interface RunePanelApi {
  hide(): void
  log(message: string): void
  quit(): void
  /**
   * How main animated the window at launch. Not a live value — later changes
   * arrive on each motion event. See `preload/index.ts`.
   */
  motionMode: MotionMode
  /** Tell main whether the OS has asked for reduced motion. */
  reportReduceMotion(reduce: boolean): void

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
  capturePane(): Promise<string | null>
  setPaneBounds(bounds: PaneBounds): void
  lookupProfile(username: string): Promise<ProfileSummary>

  geDetail(itemId: number, timestep?: GeTimestep): Promise<GeItemDetail | null>
  geFindByName(name: string): Promise<GeItem | null>
  gePrices(ids: number[]): Promise<Array<{ id: number; price: GePrice | null }>>

  hiscores(name: string, mode?: AccountMode): Promise<Hiscores>

  getSetup(): Promise<SetupProgress>
  runSetup(options: { prices: boolean }): void
  onSetupProgress(cb: (progress: SetupProgress) => void): () => void

  getUpdate(): Promise<UpdateStatus>
  checkUpdate(): void
  downloadUpdate(): void
  installUpdate(): void
  onUpdateStatus(cb: (status: UpdateStatus) => void): () => void

  onShown(cb: () => void): () => void
  onMotion(cb: (event: MotionEvent) => void): () => void
  onSettings(cb: (settings: Settings) => void): () => void
  onSyncProgress(cb: (progress: SyncProgress) => void): () => void
  onCrawlProgress(cb: (state: CrawlState) => void): () => void
  onPaneLoading(cb: (loading: boolean) => void): () => void
  onPaneShortcut(cb: (which: PaneShortcut) => void): () => void
}

declare global {
  interface Window {
    rp: RunePanelApi
  }
}
