/**
 * The title index — every content-namespace page name, held locally.
 *
 * This is what makes search feel instant: ~41k articles plus their redirects,
 * matched in memory in the renderer rather than round-tripped to CirrusSearch
 * on every keystroke. It costs about 150 requests once, and refreshes rarely.
 *
 * Redirects are worth the extra two passes. OSRS pages accumulate aliases
 * ("Whip", "Bandos tassets", "Bowfa"), and without knowing where each points,
 * search shows the alias and the article as two unrelated hits. The API will
 * not hand over source and target together — `redirects=1` is rejected outright
 * with `generator=allpages` — so they are collected separately and joined on
 * page id: `allpages` gives source title plus pageid, `allredirects` gives
 * target title plus the same id as `fromid`.
 */

import * as db from '../db'
import * as client from './client'

export type SyncPhase =
  | 'idle'
  | 'articles'
  | 'redirects'
  | 'targets'
  | 'writing'
  | 'done'
  | 'error'

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

const KEY_SYNCED_AT = 'titles.synced_at'
/** Refresh the index weekly; new pages are rare and recentchanges covers edits. */
export const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/** Guards against a hand-triggered sync landing on top of the automatic one. */
let running: Promise<void> | null = null
let progress: SyncProgress = { phase: 'idle', fetched: 0, requests: 0 }

type Listener = (progress: SyncProgress) => void
const listeners = new Set<Listener>()

export function onProgress(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function state(): TitleIndexState {
  const counts = db
    .get()
    .prepare('SELECT COUNT(*) AS total, SUM(is_redirect) AS redirects FROM titles')
    .get() as { total: number; redirects: number | null }

  return {
    count: counts.total,
    redirects: counts.redirects ?? 0,
    syncedAt: db.kvGetNumber(KEY_SYNCED_AT),
    syncing: running !== null,
    progress,
  }
}

export function isStale(): boolean {
  const at = db.kvGetNumber(KEY_SYNCED_AT)
  return at === null || Date.now() - at > MAX_AGE_MS
}

export interface SyncOptions {
  /**
   * Stop each phase after this many pages. Used by `--sync-titles --dry-run` to
   * prove the pagination and response shapes in a handful of requests instead
   * of 150. A capped run never prunes, since almost nothing would survive it.
   */
  maxPagesPerPhase?: number
}

/** Start a sync, or return the one already in flight. */
export function sync(
  priority: client.Priority = 'background',
  options: SyncOptions = {}
): Promise<void> {
  if (running) return running
  running = run(priority, options).finally(() => {
    running = null
  })
  return running
}

async function run(priority: client.Priority, options: SyncOptions): Promise<void> {
  const startedAt = Date.now()
  const before = client.getStats().sent
  let fetched = 0

  const capped = options.maxPagesPerPhase ?? Infinity

  const report = (phase: SyncPhase, message?: string): void => {
    progress = { phase, fetched, requests: client.getStats().sent - before, message }
    for (const listener of listeners) listener(progress)
  }

  try {
    report('articles')

    // Articles first, written as they arrive. An interrupted sync then still
    // leaves a usable index rather than nothing.
    for await (const batch of paginate<PageRef>(
      { action: 'query', list: 'allpages', apnamespace: 0, aplimit: 500, apfilterredir: 'nonredirects' },
      'allpages',
      priority,
      capped
    )) {
      writeTitles(
        batch.map((p) => ({ title: p.title, isRedirect: 0, target: null })),
        startedAt
      )
      fetched += batch.length
      report('articles')
    }

    report('redirects')

    // Redirect sources: pageid -> the redirect's own title.
    const sources = new Map<number, string>()
    for await (const batch of paginate<PageRef>(
      { action: 'query', list: 'allpages', apnamespace: 0, aplimit: 500, apfilterredir: 'redirects' },
      'allpages',
      priority,
      capped
    )) {
      for (const page of batch) sources.set(page.pageid, page.title)
      fetched += batch.length
      report('redirects')
    }

    report('targets')

    // Redirect targets: the same pageid, arriving as `fromid`, mapped to where
    // it points. Several redirects share one target, so this is many-to-one.
    const targets = new Map<number, string>()
    for await (const batch of paginate<RedirectRef>(
      { action: 'query', list: 'allredirects', arnamespace: 0, arlimit: 500, arprop: 'ids|title' },
      'allredirects',
      priority,
      capped
    )) {
      for (const redirect of batch) targets.set(redirect.fromid, redirect.title)
      report('targets')
    }

    report('writing')

    writeTitles(
      [...sources].map(([pageid, title]) => ({
        title,
        isRedirect: 1,
        // A broken redirect — one pointing at nothing the API will resolve —
        // is still a real title worth matching, just without a destination.
        target: targets.get(pageid) ?? null,
      })),
      startedAt
    )

    // Anything not touched this run no longer exists on the wiki. Only safe
    // after every phase ran to completion — a capped or partial run would
    // delete the titles it simply never reached, which on a dry run is almost
    // all of them.
    let removed = 0
    let unresolved = 0
    if (capped === Infinity) {
      removed = Number(
        db.get().prepare('DELETE FROM titles WHERE synced_at < ?').run(startedAt).changes
      )
      unresolved = dropUnresolvableTargets()
      db.kvSet(KEY_SYNCED_AT, Date.now())
    }

    report(
      'done',
      capped === Infinity
        ? `${fetched} titles, ${removed} removed, ${unresolved} off-wiki targets cleared`
        : 'dry run'
    )
  } catch (err) {
    report('error', err instanceof Error ? err.message : String(err))
    throw err
  }
}

// ── plumbing ────────────────────────────────────────────────────────────────

interface PageRef {
  pageid: number
  title: string
}

interface RedirectRef {
  fromid: number
  title: string
}

interface QueryResponse {
  query?: Record<string, unknown>
  continue?: Record<string, string>
}

/** Hard stop on pagination, so a misbehaving `continue` cannot loop forever. */
const MAX_PAGES = 2000

/**
 * Walk a MediaWiki list endpoint.
 *
 * Continuation is handled generically: whatever keys the API puts in
 * `continue` get merged into the next request, which is the documented
 * contract and avoids hard-coding `apcontinue` per list.
 */
async function* paginate<T>(
  params: Record<string, string | number>,
  list: string,
  priority: client.Priority,
  maxPages = Infinity
): AsyncGenerator<T[]> {
  const limit = Math.min(maxPages, MAX_PAGES)
  let cont: Record<string, string> = {}

  for (let page = 0; page < limit; page++) {
    const body = await client.query<QueryResponse>({ ...params, ...cont }, priority)
    const items = (body.query?.[list] ?? []) as T[]
    if (items.length > 0) yield items
    if (!body.continue) return
    cont = body.continue
  }

  // Reaching a deliberate cap is the caller getting what they asked for.
  // Reaching the safety ceiling means the API is not terminating.
  if (limit === MAX_PAGES) throw new Error(`pagination of ${list} exceeded ${MAX_PAGES} pages`)
}

/**
 * Clear redirect targets that are not themselves local articles.
 *
 * A handful of redirects point off this wiki entirely — `Api` resolves to
 * `rsw:Application programming interface` on the RS3 wiki, and the Dragonwilds
 * aliases point at a page outside the content namespace. The API reports the
 * target faithfully; we simply cannot render it.
 *
 * Nulling them buys a strong invariant for everything downstream: a target is
 * either NULL or a title that exists locally. Search and navigation never have
 * to defend against following a redirect into nothing. The redirect's own title
 * stays in the index and stays searchable — only the unusable destination goes.
 */
function dropUnresolvableTargets(): number {
  const result = db
    .get()
    .prepare(
      `UPDATE titles SET target = NULL
       WHERE target IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM titles t WHERE t.title = titles.target)`
    )
    .run()
  return Number(result.changes)
}

interface TitleRow {
  title: string
  isRedirect: 0 | 1
  target: string | null
}

function writeTitles(rows: TitleRow[], syncedAt: number): void {
  if (rows.length === 0) return
  const d = db.get()
  const insert = d.prepare(
    `INSERT INTO titles (title, is_redirect, target, synced_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(title) DO UPDATE SET
       is_redirect = excluded.is_redirect,
       target      = excluded.target,
       synced_at   = excluded.synced_at`
  )

  // One transaction per batch. Without it SQLite commits per row, which turns
  // 70k inserts from about a second into several minutes.
  d.exec('BEGIN')
  try {
    for (const row of rows) insert.run(row.title, row.isRedirect, row.target, syncedAt)
    d.exec('COMMIT')
  } catch (err) {
    d.exec('ROLLBACK')
    throw err
  }
}
