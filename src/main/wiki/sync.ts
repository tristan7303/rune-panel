/**
 * Keeping the cache current, and filling it in the background.
 *
 * Two jobs that both want to be invisible.
 *
 * **Invalidation** asks what changed rather than checking what we hold. Polling
 * revision ids for tens of thousands of cached pages would be thousands of
 * requests; `list=recentchanges` answers the same question in one, because the
 * wiki already keeps that list. A week of edits fits in a handful of pages.
 *
 * **The crawler** fills the cache while you are not looking, and stops the
 * instant you are. Anything the window is showing outranks it — the client
 * queue gives interactive work priority, and the crawler pauses outright when
 * the window is visible, so a background fill cannot compete for bandwidth with
 * the page you are actually reading.
 */

import * as db from '../db'
import * as client from './client'
import * as page from './page'

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

const KEY_LAST_CHECK = 'sync.recentchanges_at'
/** Ask what changed at most this often. */
const CHECK_INTERVAL_MS = 60 * 60 * 1000
/** Gentler than the interactive ceiling; this is work nobody asked for. */
const CRAWL_INTERVAL_MS = 500
/** Stop after this many pages in one sitting, so an idle machine is not crawled forever. */
const CRAWL_BUDGET = 400

/**
 * Seed titles, most useful first.
 *
 * Deliberately short and hand-picked rather than generated: these are the pages
 * worth having before you ask for them. Everything else arrives by being
 * visited, which is a better predictor of what you want than any heuristic I
 * could write.
 */
const SEEDS = [
  'Attack', 'Strength', 'Defence', 'Ranged', 'Prayer', 'Magic', 'Runecraft',
  'Construction', 'Hitpoints', 'Agility', 'Herblore', 'Thieving', 'Crafting',
  'Fletching', 'Slayer', 'Hunter', 'Mining', 'Smithing', 'Fishing', 'Cooking',
  'Firemaking', 'Woodcutting', 'Farming',
  'Quests/List', 'Combat level', 'Combat Achievements', 'Achievement Diary',
  'Grand Exchange', 'Money making guide', 'Optimal quest guide',
  'Chambers of Xeric', 'Theatre of Blood', 'Tombs of Amascut',
  'Zulrah', 'Vorkath', 'Corporeal Beast', 'Cerberus', 'Alchemical Hydra',
  'Nightmare of Ashihama', 'Nex', "Phosani's Nightmare",
  'Fight Caves', 'Inferno', 'Barrows', 'Wilderness', 'Slayer task',
] as const

let state: CrawlState = { phase: 'idle', done: 0, remaining: 0, cached: 0, stale: 0 }
let queue: string[] = []
let running = false
let stopRequested = false
/** Set by main from the window's show/hide events. */
let windowVisible = false

type Listener = (state: CrawlState) => void
const listeners = new Set<Listener>()

export function onProgress(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getState(): CrawlState {
  const counts = db
    .get()
    .prepare('SELECT COUNT(*) AS cached, COALESCE(SUM(stale), 0) AS stale FROM pages')
    .get() as { cached: number; stale: number }
  return { ...state, cached: counts.cached, stale: counts.stale, remaining: queue.length }
}

function emit(phase: CrawlPhase, message?: string): void {
  state = { ...state, phase, message }
  const snapshot = getState()
  for (const listener of listeners) listener(snapshot)
}

/**
 * Tell the crawler whether anyone is watching.
 *
 * Called on every show and hide. Showing the window does not cancel a crawl,
 * only parks it — the loop checks between pages and resumes when you leave.
 */
export function setWindowVisible(visible: boolean): void {
  windowVisible = visible
  if (visible && state.phase === 'crawling') emit('paused')
}

export function stop(): void {
  stopRequested = true
  queue = []
}

// ── invalidation ────────────────────────────────────────────────────────────

interface RecentChangesResponse {
  query?: { recentchanges?: Array<{ title: string; revid: number }> }
  continue?: Record<string, string>
}

/**
 * Mark every cached page the wiki has edited since we last looked.
 *
 * Content is not thrown away — a stale page still renders instantly, with a
 * note, and refreshes on next view or when the crawler reaches it. Deleting it
 * would trade a slightly-old page for no page at all.
 */
export async function refreshStale(): Promise<number> {
  const since = db.kvGetNumber(KEY_LAST_CHECK)
  // First run has no baseline. A week is enough to catch anything cached during
  // development without walking the entire change log.
  const from = new Date(since ?? Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const startedAt = Date.now()

  let cont: Record<string, string> = {}
  let marked = 0

  for (let requests = 0; requests < 40; requests++) {
    const body = await client.query<RecentChangesResponse>(
      {
        action: 'query',
        list: 'recentchanges',
        rcnamespace: 0,
        rclimit: 500,
        rcprop: 'title|ids|timestamp',
        rcend: from,
        rctype: 'edit|new',
        ...cont,
      },
      'background'
    )

    const changes = body.query?.recentchanges ?? []
    if (changes.length > 0) {
      const d = db.get()
      // `revid <` rather than `!=`: an edit we already hold the result of — the
      // crawler having just re-fetched it, say — must not be marked stale again.
      const mark = d.prepare('UPDATE pages SET stale = 1 WHERE title = ? AND revid < ?')
      d.exec('BEGIN')
      try {
        for (const change of changes) {
          marked += Number(mark.run(change.title, change.revid).changes)
        }
        d.exec('COMMIT')
      } catch (err) {
        d.exec('ROLLBACK')
        throw err
      }
    }

    if (!body.continue) break
    cont = body.continue
  }

  db.kvSet(KEY_LAST_CHECK, startedAt)
  return marked
}

// ── the crawler ─────────────────────────────────────────────────────────────

/**
 * Refresh what is stale, then fill what is missing.
 *
 * Safe to call repeatedly; a second call while one is running is a no-op.
 */
export async function run(): Promise<void> {
  if (running) return
  running = true
  stopRequested = false
  state = { ...state, done: 0 }

  try {
    const since = db.kvGetNumber(KEY_LAST_CHECK)
    if (since === null || Date.now() - since > CHECK_INTERVAL_MS) {
      emit('refreshing')
      const marked = await refreshStale()
      if (marked > 0) console.log(`[sync] ${marked} cached pages went stale`)
    }

    queue = buildQueue()
    emit('crawling')

    while (queue.length > 0 && !stopRequested && state.done < CRAWL_BUDGET) {
      if (windowVisible) {
        // Someone is reading. Park rather than compete.
        if (state.phase !== 'paused') emit('paused')
        await sleep(2000)
        continue
      }
      if (state.phase !== 'crawling') emit('crawling')

      const title = queue.shift()
      if (!title) break

      try {
        await page.get(title, { force: true, priority: 'background' })
        state.done++
      } catch (err) {
        // A single bad title must not end the crawl.
        console.warn(`[sync] ${title}:`, err instanceof Error ? err.message : err)
      }

      emit(state.phase)
      await sleep(CRAWL_INTERVAL_MS)
    }

    emit('done', `${state.done} pages`)
  } catch (err) {
    emit('error', err instanceof Error ? err.message : String(err))
  } finally {
    running = false
  }
}

/**
 * Stale pages first, then unfetched seeds.
 *
 * Correcting something wrong beats adding something missing: a stale page is
 * already on screen for someone, while an absent one costs a visible fetch at
 * worst.
 */
function buildQueue(): string[] {
  const stale = (
    db.get().prepare('SELECT title FROM pages WHERE stale = 1').all() as Array<{ title: string }>
  ).map((r) => r.title)

  // Plain titles, passed through as-is. An earlier version URL-encoded them and
  // decoded here, which does nothing useful and would throw on any title
  // containing a literal `%`.
  const held = db.get().prepare('SELECT 1 FROM pages WHERE title = ?')
  const missing = SEEDS.filter((title) => !held.get(title))

  return [...stale, ...missing]
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
