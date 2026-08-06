/**
 * Article fetching and caching.
 *
 * A page is fetched once, transformed once, and stored. Every later visit is a
 * disk read of a few hundred KB, which is what makes navigation feel local
 * rather than networked. Staleness is handled by phase 4's `recentchanges`
 * sweep marking rows rather than by expiry here: a wiki page that has not been
 * edited does not need re-fetching, however old the copy is.
 */

import * as db from '../db'
import * as client from './client'
import { transform, type Infobox } from './transform'

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

export interface Section {
  level: number
  line: string
  anchor: string
}

interface ParseResponse {
  parse?: {
    title: string
    revid: number
    text: string
    sections?: Array<{ level: string; line: string; anchor: string }>
    categories?: Array<{ category: string; hidden?: boolean }>
  }
}

/** Concurrent requests for one title share a download. */
const inFlight = new Map<string, Promise<Article | null>>()

export function getCached(title: string): Article | null {
  const row = db
    .get()
    .prepare(
      'SELECT title, revid, html, infobox, sections, categories, fetched_at, stale FROM pages WHERE title = ?'
    )
    .get(title) as
    | {
        title: string
        revid: number
        html: string
        infobox: string | null
        sections: string | null
        categories: string | null
        fetched_at: number
        stale: number
      }
    | undefined

  if (!row) return null

  return {
    title: row.title,
    revid: row.revid,
    html: row.html,
    infobox: row.infobox ? (JSON.parse(row.infobox) as Infobox) : null,
    sections: row.sections ? (JSON.parse(row.sections) as Section[]) : [],
    categories: row.categories ? (JSON.parse(row.categories) as string[]) : [],
    fetchedAt: row.fetched_at,
    cached: true,
    stale: row.stale === 1,
  }
}

/**
 * Fetch an article, preferring the cache.
 *
 * `force` re-fetches a page already held — used when a row is stale, and by the
 * reload control.
 */
export async function get(
  title: string,
  options: { force?: boolean; priority?: client.Priority } = {}
): Promise<Article | null> {
  if (!options.force) {
    const cached = getCached(title)
    if (cached) return cached
  }

  const key = title
  const existing = inFlight.get(key)
  if (existing) return existing

  const job = fetchAndStore(title, options.priority ?? 'interactive').finally(() =>
    inFlight.delete(key)
  )
  inFlight.set(key, job)
  return job
}

/**
 * Warm the cache without returning anything.
 *
 * Used by hover prefetch, so a click is a disk read. Failures are swallowed on
 * purpose: a speculative fetch that misses must never surface as an error the
 * user did not ask for.
 */
export function prefetch(title: string): void {
  if (getCached(title)) return
  void get(title, { priority: 'background' }).catch(() => {})
}

async function fetchAndStore(title: string, priority: client.Priority): Promise<Article | null> {
  const body = await client.query<ParseResponse>(
    {
      action: 'parse',
      page: title,
      // Follows a redirect server-side, so `Bowfa` returns the whip's article
      // and reports the canonical title back in `parse.title`.
      redirects: 1,
      prop: 'text|sections|categories|revid',
      disableeditsection: 1,
      disabletoc: 1,
    },
    priority
  )

  const parsed = body.parse
  if (!parsed) return null

  const { html, infobox } = transform(parsed.text, parsed.title)

  const sections: Section[] = (parsed.sections ?? []).map((s) => ({
    level: Number(s.level) || 2,
    line: s.line,
    anchor: s.anchor,
  }))

  // Hidden categories are maintenance bookkeeping ("Pages with broken file
  // links") and mean nothing to a reader.
  const categories = (parsed.categories ?? [])
    .filter((c) => !c.hidden)
    .map((c) => c.category.replace(/_/g, ' '))

  const fetchedAt = Date.now()

  db.get()
    .prepare(
      `INSERT INTO pages (title, revid, html, infobox, sections, categories, fetched_at, stale)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)
       ON CONFLICT(title) DO UPDATE SET
         revid = excluded.revid, html = excluded.html, infobox = excluded.infobox,
         sections = excluded.sections, categories = excluded.categories,
         fetched_at = excluded.fetched_at, stale = 0`
    )
    .run(
      parsed.title,
      parsed.revid,
      html,
      infobox ? JSON.stringify(infobox) : null,
      JSON.stringify(sections),
      JSON.stringify(categories),
      fetchedAt
    )

  return {
    title: parsed.title,
    revid: parsed.revid,
    html,
    infobox,
    sections,
    categories,
    fetchedAt,
    cached: false,
    stale: false,
  }
}
