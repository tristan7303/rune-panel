/**
 * The search palette — the primary way into everything.
 *
 * Search runs in main over an in-memory index and returns in ~10ms, so there is
 * no debounce: every keystroke queries. What there *is* is a sequence guard,
 * because IPC replies can land out of order and a stale reply overwriting a
 * fresh one is the one bug this design can produce.
 */

import { useEffect, useRef, useState, type JSX } from 'react'
import type { SearchResult, TitleIndexState } from '@shared/ipc'
import { useNav } from './nav'
import { SearchIcon } from './icons'

export function Search(): JSX.Element {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [selected, setSelected] = useState(0)
  const [index, setIndex] = useState<TitleIndexState | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const push = useNav((s) => s.push)

  // Monotonic request id. Only the newest reply is allowed to paint.
  const latest = useRef(0)

  useEffect(() => {
    inputRef.current?.focus()
    void window.rb.getTitleIndex().then(setIndex)
    return window.rb.onSyncProgress(() => {
      void window.rb.getTitleIndex().then(setIndex)
    })
  }, [])

  useEffect(() => {
    const seq = ++latest.current
    if (query.trim().length < 2) {
      setResults([])
      setSelected(0)
      return
    }
    void window.rb.search(query).then((hits) => {
      if (seq !== latest.current) return
      setResults(hits)
      setSelected(0)
    })
  }, [query])

  // Keep the highlighted row in view when navigating by keyboard.
  useEffect(() => {
    listRef.current?.children[selected]?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const open = (result: SearchResult): void => push({ kind: 'page', title: result.title })

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && results[selected]) {
      e.preventDefault()
      open(results[selected])
    }
    // Escape is deliberately not handled here — it belongs to the window-level
    // handler in App, which unwinds one layer at a time.
  }

  const empty = query.trim().length >= 2 && results.length === 0

  return (
    <div className="search">
      <div className="search-field">
        <SearchIcon />
        <input
          ref={inputRef}
          type="text"
          className="search-input"
          placeholder="Search the wiki…"
          spellCheck={false}
          autoComplete="off"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>

      {results.length > 0 && (
        <ul className="results" ref={listRef} role="listbox">
          {results.map((r, i) => (
            <li
              key={`${r.title}:${r.matchedVia ?? ''}`}
              role="option"
              aria-selected={i === selected}
              className={`result ${i === selected ? 'is-selected' : ''}`}
              onMouseEnter={() => setSelected(i)}
              onClick={() => open(r)}
            >
              <span className="result-title">{r.title}</span>
              {r.matchedVia && <span className="result-alias">matched “{r.matchedVia}”</span>}
            </li>
          ))}
        </ul>
      )}

      {empty && <p className="search-note">No pages match “{query.trim()}”.</p>}

      {query.trim().length < 2 && <IndexStatus index={index} />}
    </div>
  )
}

/**
 * What the index knows, shown only on the empty state.
 *
 * The first launch spends four minutes building this in the background, and a
 * search palette that silently finds nothing is indistinguishable from a broken
 * one. Saying so costs a line.
 */
function IndexStatus({ index }: { index: TitleIndexState | null }): JSX.Element | null {
  if (!index) return null

  if (index.syncing) {
    const { phase, fetched, requests } = index.progress
    return (
      <p className="search-note">
        Building the index — {phase}, {fetched.toLocaleString()} titles over {requests} requests.
        Search works as it fills.
      </p>
    )
  }

  if (index.count === 0) {
    return (
      <p className="search-note">
        No index yet. It builds automatically on first launch, or from Settings.
      </p>
    )
  }

  const articles = index.count - index.redirects
  return (
    <p className="search-note">
      {articles.toLocaleString()} articles and {index.redirects.toLocaleString()} aliases indexed.
      Type at least two characters.
    </p>
  )
}
