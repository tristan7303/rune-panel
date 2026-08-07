/**
 * GE Tracker, with a native way in.
 *
 * Their site is the point — live margins, volumes and price history that this
 * app does not compute — and their API is paid, so the page is embedded rather
 * than reimplemented. Same bargain as the DPS calculator and RuneProfile.
 *
 * What is ours is the search. Their item lookup means clicking into their nav,
 * typing, and reading a dropdown, which is three interactions inside an embedded
 * view to answer "what is a tbow going for".
 *
 * This box is the same one the Grand Exchange page uses, down to the keyboard
 * contract: uFuzzy over the wiki title index for the suggestions, then the item
 * list to resolve the chosen title. Two indexes rather than one because they
 * answer different halves — the titles carry every alias people actually type,
 * so "bowfa" and "tbow" land on the right article, and the item list is what
 * says whether that article is a tradeable thing with a price. Searching the
 * item names alone would match neither nickname.
 *
 * The pane loads immediately rather than waiting for a search. Unlike
 * RuneProfile, whose page is meaningless without a username, GE Tracker's front
 * page is a useful thing to land on.
 */

import { useEffect, useRef, useState, type JSX } from 'react'
import type { SearchResult } from '@shared/ipc'
import { ToolPane } from './ToolPane'
import { SearchIcon } from './icons'
import { usePrimaryInput } from './focus'
import { useStore } from './store'

/**
 * Their item URLs.
 *
 * `/item/twisted-bow`, `/item/abyssal-whip` — lowercased, with every run of
 * non-alphanumerics collapsed to a single hyphen. Derived rather than looked up:
 * it holds for every item checked, and a mapping table for thousands of items
 * would go stale the first time one is added.
 */
export function itemSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function GeTracker(): JSX.Element {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [selected, setSelected] = useState(0)
  const [slug, setSlug] = useState<string | undefined>(undefined)
  const [showing, setShowing] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = usePrimaryInput()
  const live = useRef(true)

  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])

  /**
   * Stand the pane down while the suggestions are up.
   *
   * The pane is a WebContentsView, which composites above the DOM and cannot
   * be layered under anything — a dropdown drawn here would be behind the
   * website and invisible. Registering its rectangle makes the pane shrink
   * clear of it and restore afterwards, the same contract the header search
   * and the theme menu use.
   *
   * Keyed on the result count as well as visibility, so the rectangle tracks a
   * list that grows and shrinks as you type rather than being measured once at
   * whatever size it opened with.
   */
  const pushOverlay = useStore((s) => s.pushOverlay)
  const popOverlay = useStore((s) => s.popOverlay)
  const setOverlayRect = useStore((s) => s.setOverlayRect)
  const resultsRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    if (results.length === 0) return
    pushOverlay()
    // After paint: the list has no measurable size until it has been laid out.
    const frame = requestAnimationFrame(() => {
      const r = resultsRef.current?.getBoundingClientRect()
      if (r) setOverlayRect({ x: r.x, y: r.y, width: r.width, height: r.height })
    })
    return () => {
      cancelAnimationFrame(frame)
      popOverlay()
    }
  }, [results.length, pushOverlay, popOverlay, setOverlayRect])

  // Suggestions on every keystroke. The index is in memory in main and uFuzzy
  // ranks it in under a millisecond, so there is nothing here worth debouncing.
  // Two characters is the floor because one matches most of the wiki.
  useEffect(() => {
    setSelected(0)
    if (query.trim().length < 2) return setResults([])
    let running = true
    void window.rp.search(query).then((hits) => {
      if (!running) return
      setResults(hits.slice(0, 12))
      setSelected(0)
    })
    return () => {
      running = false
    }
  }, [query])

  /**
   * Resolve a wiki title to a tradeable item, then send the pane to it.
   *
   * Checked before navigating, rather than building a slug from whatever was
   * typed: an unresolvable slug is a 404 inside someone else's page, several
   * seconds later, with no obvious way back. Untradeable articles are the
   * common case here — plenty of pages are things GE Tracker has no entry for.
   */
  const open = async (title: string): Promise<void> => {
    setError(null)
    try {
      const item = await window.rp.geFindByName(title)
      if (!live.current) return
      if (!item) {
        setError(`“${title}” is not a tradeable item.`)
        return
      }
      // The item list's spelling, not the typed one — it is what the slug has
      // to be built from.
      setSlug(itemSlug(item.name))
      setShowing(item.name)
      setQuery('')
      setResults([])
    } catch (err) {
      if (live.current) setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="tool-host">
      <div className="tool-bar">
        <div className="ge-tracker-search">
          <div className="search-field">
            <SearchIcon />
            <input
              ref={inputRef}
              type="text"
              className="search-input"
              placeholder="Find an item…"
              spellCheck={false}
              autoComplete="off"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              // The same keyboard contract as the wiki search and the Grand
              // Exchange page: arrows move the highlight, Enter takes it.
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setSelected((i) => Math.min(i + 1, results.length - 1))
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setSelected((i) => Math.max(i - 1, 0))
                } else if (e.key === 'Enter' && results[selected]) {
                  e.preventDefault()
                  void open(results[selected].title)
                } else if (e.key === 'Escape' && query) {
                  // Clear the query before the window-level handler closes the app.
                  e.stopPropagation()
                  setQuery('')
                }
              }}
            />
          </div>
          {results.length > 0 && (
            <ul className="results ge-tracker-results" role="listbox" ref={resultsRef}>
              {results.map((r, i) => (
                <li
                  key={r.title}
                  role="option"
                  aria-selected={i === selected}
                  className={`result ${i === selected ? 'is-selected' : ''}`}
                  onMouseEnter={() => setSelected(i)}
                  onClick={() => void open(r.title)}
                >
                  <span className="result-title">{r.title}</span>
                  {r.matchedVia && <span className="result-alias">matched “{r.matchedVia}”</span>}
                </li>
              ))}
            </ul>
          )}
        </div>

        {showing && (
          <>
            <span className="tool-bar-title">{showing}</span>
            <button
              className="link-btn"
              onClick={() => {
                setSlug(undefined)
                setShowing(null)
              }}
            >
              front page
            </button>
          </>
        )}
        {error && <span className="tool-bar-error">{error}</span>}
      </div>

      <ToolPane id="getracker" arg={slug} />
    </div>
  )
}
