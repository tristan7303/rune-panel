/**
 * Title search.
 *
 * Runs in main, over an in-memory copy of the title index. Measured on the real
 * 239k-row index: 6-10ms to filter, 0-3ms to rank. Well inside a frame, so the
 * palette can search on every keystroke with no debounce.
 *
 * Main rather than the renderer for three reasons: the database is here, the
 * 6.6 MB haystack is not worth serialising across IPC or holding twice, and the
 * renderer thread stays free to actually paint.
 *
 * The interesting problem is not matching, it is *collapsing*. OSRS pages carry
 * 5.7 redirects each — `Abyssal whip` alone answers to `Abby whip`, `Abbysal
 * whip`, `Abhssal whip` and dozens more. A raw match for "aby" returns 1,108
 * rows that are really a few dozen articles wearing hats. So every hit is
 * resolved to its canonical article and deduped, which is what turns the wiki's
 * enormous redirect table from noise into exactly the typo tolerance you want:
 * the wiki has already written down every misspelling anyone makes.
 */

import uFuzzy from '@leeoniya/ufuzzy'
import * as db from '../db'
import * as settings from '../settings'
import type { KeywordAlias } from '../../shared/ipc'

export interface SearchResult {
  /** The canonical article to navigate to. */
  title: string
  /** The alias that actually matched, when it differs from `title`. */
  matchedVia?: string
}

/** More than fits the palette; the UI shows a slice of this. */
const LIMIT = 40
/** One character matches most of the wiki and tells the user nothing. */
const MIN_QUERY = 2

/**
 * Single-error tolerance within each term: one insertion, substitution,
 * transposition or deletion.
 *
 * Measured against the real 239k index, this is free — 11ms worst case versus
 * 12ms for strict matching — and it rescues queries strict matching drops
 * outright: "dragn scim" goes from 0 hits to 57, "abyssl whip" from 2 to 48.
 * The wiki's own redirects already cover misspellings anyone has bothered to
 * write down; this covers the ones they have not.
 */
const fuzzy = new uFuzzy({ intraMode: 1, intraIns: 1, intraSub: 1, intraTrn: 1, intraDel: 1 })

/** Every title, in row order. The uFuzzy haystack. */
let haystack: string[] = []
/**
 * Parallel to `haystack`: the index of each row's canonical article, or -1 if
 * the row is already one. An Int32Array rather than a string array keeps this
 * at ~1 MB instead of duplicating 6 MB of titles.
 */
let canonical = new Int32Array(0)
let loaded = false

/** Drop the in-memory index. Called after a sync replaces the rows. */
export function invalidate(): void {
  haystack = []
  canonical = new Int32Array(0)
  loaded = false
}

export function isLoaded(): boolean {
  return loaded
}

/**
 * Build the in-memory index from SQLite. ~180ms for 239k rows.
 *
 * Deliberately lazy: startup should not pay for a search the user may never
 * run, and on first launch there is nothing to load anyway.
 */
export function load(): void {
  if (loaded) return

  // No ORDER BY: `titles` is WITHOUT ROWID, so it has no rowid to order by and
  // a scan already comes back in primary-key order. Row order is irrelevant to
  // results anyway — uFuzzy ranks by match quality.
  const rows = db.get().prepare('SELECT title, target FROM titles').all() as Array<{
    title: string
    target: string | null
  }>

  haystack = new Array<string>(rows.length)
  canonical = new Int32Array(rows.length).fill(-1)

  // Built only to resolve targets to row indices, then released — keeping a
  // 239k-entry Map alive would cost more than the index it serves.
  const indexOf = new Map<string, number>()
  for (let i = 0; i < rows.length; i++) {
    haystack[i] = rows[i].title
    indexOf.set(rows[i].title, i)
  }

  for (let i = 0; i < rows.length; i++) {
    const target = rows[i].target
    if (target === null) continue
    // Phase 1 guarantees a target is either NULL or a title that exists
    // locally, so a miss here would mean the invariant broke; -1 degrades to
    // "treat it as its own article" rather than throwing.
    canonical[i] = indexOf.get(target) ?? -1
  }

  loaded = true
}

/**
 * Substitute any configured synonym, whole words or whole phrases.
 *
 * Returns null when nothing applies, which is the common case and worth not
 * paying a second search for. Matching is on word boundaries rather than by
 * substring, so a rule for "bis" cannot fire inside "Bisque"; a phrase rule
 * matches the same way, as a run of consecutive words, so "best in slot"
 * cannot fire across "the best inn". Case is folded because the rules are
 * stored lowercased and nobody capitalises a search box.
 */
function expand(query: string, aliases: KeywordAlias[]): string | null {
  // Both halves written — the editor stores a rule from the moment you add the
  // row, so half of one is the normal state while it is being typed rather
  // than something to complain about. Whitespace is normalised here because
  // the sanitizer deliberately leaves it alone (trimming there ate the space
  // being typed between the words of a phrase).
  const usable = aliases
    .filter((a) => a.from.trim() && a.to.trim())
    .map((a) => ({ from: a.from.trim().split(/\s+/), to: a.to.trim().replace(/\s+/g, ' ') }))
    // Longest phrase first, so a rule for "best in slot" wins over one for
    // "best" at the same position instead of losing to list order.
    .sort((a, b) => b.from.length - a.from.length)
  if (usable.length === 0) return null

  const words = query.split(/\s+/)
  const lower = words.map((w) => w.toLowerCase())
  const out: string[] = []
  let changed = false
  for (let i = 0; i < words.length; ) {
    const rule = usable.find((r) => r.from.every((w, n) => lower[i + n] === w))
    if (rule) {
      // The matched words are consumed together and never rescanned, so one
      // rule's output cannot trigger another's.
      out.push(rule.to)
      i += rule.from.length
      changed = true
    } else {
      out.push(words[i])
      i += 1
    }
  }
  return changed ? out.join(' ') : null
}

export function search(query: string, limit = LIMIT): SearchResult[] {
  const q = query.trim()
  if (q.length < MIN_QUERY) return []

  load()
  if (haystack.length === 0) return []

  /**
   * A synonym is an instruction, so its results lead.
   *
   * "scurrius bis" matches no page at all as typed — the whole reason the rule
   * exists — so ranking the literal query first would bury the page that was
   * actually asked for under whatever the fuzzy matcher salvaged. The literal
   * results still follow, deduped, because a rule firing on a word that also
   * means something by itself should not hide the page named after it.
   */
  const expanded = expand(q, settings.get().keywordAliases)
  if (expanded) {
    const merged = rank(expanded, limit)
    const seen = new Set(merged.map((r) => r.title))
    for (const hit of rank(q, limit)) {
      if (merged.length >= limit) break
      if (!seen.has(hit.title)) {
        seen.add(hit.title)
        merged.push(hit)
      }
    }
    return merged
  }

  return rank(q, limit)
}

/** One pass of match, collapse and promote for a single spelling of a query. */
function rank(q: string, limit: number): SearchResult[] {
  const hits = fuzzy.filter(haystack, q)
  if (!hits || hits.length === 0) return []

  // uFuzzy's own ranking handles match position and tightness; ordering by it
  // before collapsing means the best-matching alias is the one that survives
  // dedupe for each article.
  const info = fuzzy.info(hits, haystack, q)
  const order = fuzzy.sort(info, haystack, q)

  const lower = q.toLowerCase()
  const results: SearchResult[] = []
  /** article row index -> position in `results`, so a later row can upgrade it. */
  const slot = new Map<number, number>()

  for (const rank of order) {
    const row = info.idx[rank]
    const target = canonical[row]
    const article = target >= 0 ? target : row

    const existing = slot.get(article)
    if (existing === undefined) {
      if (results.length >= limit) continue
      slot.set(article, results.length)
      results.push(represent(row, article))
      continue
    }

    // Already have this article, but a later alias may describe it better.
    // `Bow of faerdhinen` answers to both `Bowfa` and `BOWFA RANGE`; uFuzzy
    // may rank the latter first, and showing "matched BOWFA RANGE" for the
    // query "bowfa" is just wrong. Without this, dedupe would have thrown the
    // exact match away before anything could prefer it.
    if (betterAlias(row, article, results[existing], lower)) {
      results[existing] = represent(row, article)
    }
  }

  return promoteExact(results, q)
}

function represent(row: number, article: number): SearchResult {
  return row === article
    ? { title: haystack[article] }
    : { title: haystack[article], matchedVia: haystack[row] }
}

/**
 * Should `row` replace the alias currently representing `article`?
 *
 * Two upgrades only, in order: the article's own title always beats an alias,
 * and an exact match beats a fuzzy one. Anything else leaves uFuzzy's ranking
 * alone, which is already the best signal available.
 */
function betterAlias(
  row: number,
  article: number,
  current: SearchResult,
  lowerQuery: string
): boolean {
  if (row === article) return true
  if (!current.matchedVia) return false
  if (current.matchedVia.toLowerCase() === lowerQuery) return false
  return haystack[row].toLowerCase() === lowerQuery
}

/**
 * Lift an exact title or alias match to the front.
 *
 * Fuzzy ranking optimises for match quality across the whole string and will
 * happily rank `Zulrah/Strategies` above `Zulrah` for the query "zulrah". When
 * someone types a page name exactly, they want that page.
 */
function promoteExact(results: SearchResult[], query: string): SearchResult[] {
  const q = query.toLowerCase()
  const exact = results.findIndex(
    (r) => r.title.toLowerCase() === q || r.matchedVia?.toLowerCase() === q
  )
  if (exact <= 0) return results
  const [hit] = results.splice(exact, 1)
  results.unshift(hit)
  return results
}
