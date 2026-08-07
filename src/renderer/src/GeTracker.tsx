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
 * The pane waits for a search rather than loading immediately. Their front page
 * is a signed-out marketing splash — a full-screen hero, a carousel and a call
 * to register — which is a poor thing to land on every time. Ours is the items
 * you have starred and the ones you looked at recently, which is the only
 * front page here that could say anything you did not already know.
 *
 * Both lists live in localStorage, like the hiscores and RuneProfile ones: they
 * are renderer-only convenience, and a schema migration for a list of item
 * names would be the wrong trade.
 */

import { useEffect, useRef, useState, type JSX } from 'react'
import type { SearchResult } from '@shared/ipc'
import { ToolPane } from './ToolPane'
import { SearchIcon, TrendIcon } from './icons'
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
/**
 * Their sign-in page. Verified rather than guessed — `/login` is a 404 there.
 *
 * Passed as a whole path, which the tool's url builder takes in preference to
 * an item slug; one sentinel is cheaper than a second shape on the route for a
 * page most people open once.
 */
const LOGIN_PATH = 'auth/login'

const RECENT_KEY = 'rp.getracker.recent'
const FAVOURITE_KEY = 'rp.getracker.favourites'
const MAX_RECENT = 8

/** An item as both lists remember it: enough to draw a row without a lookup. */
export interface RememberedItem {
  name: string
  /** Wiki image filename from the item list, e.g. "Twisted bow.png". */
  icon: string | null
}

function load(key: string): RememberedItem[] {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (v): v is RememberedItem => !!v && typeof (v as RememberedItem).name === 'string'
    )
  } catch {
    return []
  }
}

function save(key: string, items: RememberedItem[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(items))
  } catch {
    /* storage disabled or full; neither list is worth failing over */
  }
}

/**
 * The item's own sprite, served from the app's image cache.
 *
 * The item list stores the wiki's filename, and `rpimg://` is already wired to
 * fetch and cache those — so a starred item draws with the icon you would see
 * on its article rather than a generic placeholder.
 */
export function itemIcon(icon: string | null): string | null {
  return icon ? `rpimg://img/${encodeURIComponent(icon.replace(/ /g, '_'))}` : null
}

export function itemSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function GeTracker({ item }: { item?: string }): JSX.Element {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [selected, setSelected] = useState(0)
  // Seeded from the route, so "Price history" on an article can arrive here
  // already on the item rather than at an empty search box.
  const [slug, setSlug] = useState<string | undefined>(item ? itemSlug(item) : undefined)
  const [showing, setShowing] = useState<RememberedItem | null>(
    item ? { name: item, icon: null } : null
  )
  const [recent, setRecent] = useState<RememberedItem[]>(() => load(RECENT_KEY))
  const [favourites, setFavourites] = useState<RememberedItem[]>(() => load(FAVOURITE_KEY))
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
      const remembered: RememberedItem = { name: item.name, icon: item.icon }
      setSlug(itemSlug(item.name))
      setShowing(remembered)
      setQuery('')
      setResults([])
      setRecent((prev) => {
        const next = [remembered, ...prev.filter((r) => r.name !== remembered.name)]
        const capped = next.slice(0, MAX_RECENT)
        save(RECENT_KEY, capped)
        return capped
      })
    } catch (err) {
      if (live.current) setError(err instanceof Error ? err.message : String(err))
    }
  }

  const isFavourite = !!showing && favourites.some((f) => f.name === showing.name)

  const toggleFavourite = (): void => {
    if (!showing) return
    setFavourites((prev) => {
      const next = prev.some((f) => f.name === showing.name)
        ? prev.filter((f) => f.name !== showing.name)
        : [...prev, showing].sort((a, b) => a.name.localeCompare(b.name))
      save(FAVOURITE_KEY, next)
      return next
    })
  }

  /** Open a remembered item without going through the search. */
  const openRemembered = (entry: RememberedItem): void => {
    setError(null)
    setSlug(itemSlug(entry.name))
    setShowing(entry)
    setRecent((prev) => {
      const next = [entry, ...prev.filter((r) => r.name !== entry.name)].slice(0, MAX_RECENT)
      save(RECENT_KEY, next)
      return next
    })
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
            {/* The star sits with the item's name rather than in the page,
                because the page is theirs and this is ours. */}
            <button
              className={`ge-star ${isFavourite ? 'is-on' : ''}`}
              title={isFavourite ? `Unstar ${showing.name}` : `Star ${showing.name}`}
              aria-pressed={isFavourite}
              onClick={toggleFavourite}
            >
              {isFavourite ? '★' : '☆'}
            </button>
            <span className="tool-bar-title">{showing.name}</span>
          </>
        )}
        {error && <span className="tool-bar-error">{error}</span>}

        {/* Their own sign-in lives in the top bar the injection hides, so it
            gets a place here instead. Premium features need an account and
            there is no address bar to reach one without this. */}
        <button
          className="link-btn ge-signin"
          title="Sign in to GE Tracker — premium features need an account"
          onClick={() => {
            setShowing(null)
            setSlug(LOGIN_PATH)
          }}
        >
          sign in
        </button>
      </div>

      {slug ? (
        <ToolPane id="getracker" arg={slug} />
      ) : (
        // No pane until there is something to show in it. Mounting one for the
        // front page would load their signed-out splash, and an empty prompt
        // says more than a page asking you to register.
        <div className="ge-tracker-home">
          {favourites.length === 0 && recent.length === 0 ? (
            <div className="ge-tracker-empty">
              <TrendIcon />
              <h1>GE Tracker</h1>
              <p>
                Live margins, volume and price history from{' '}
                <strong>ge&#8209;tracker.com</strong>. Search an item above to open it, and star
                the ones you watch to keep them here.
              </p>
            </div>
          ) : (
            <>
              {favourites.length > 0 && (
                <ItemGrid title="Starred" items={favourites} onOpen={openRemembered} />
              )}
              {recent.length > 0 && (
                <ItemGrid
                  title="Recent"
                  items={recent}
                  onOpen={openRemembered}
                  onForget={(name) =>
                    setRecent((prev) => {
                      const next = prev.filter((r) => r.name !== name)
                      save(RECENT_KEY, next)
                      return next
                    })
                  }
                />
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * A run of remembered items, drawn with their own sprites.
 *
 * The icon is the point: a grid of names is a list, and a grid of item sprites
 * is recognisable at a glance, which is what makes this worth landing on. An
 * item whose icon never cached falls back to its initial rather than a gap.
 */
function ItemGrid({
  title,
  items,
  onOpen,
  onForget,
}: {
  title: string
  items: RememberedItem[]
  onOpen: (item: RememberedItem) => void
  onForget?: (name: string) => void
}): JSX.Element {
  return (
    <section className="ge-grid">
      <h2>{title}</h2>
      <ul>
        {items.map((entry) => {
          const src = itemIcon(entry.icon)
          return (
            <li key={entry.name}>
              <button className="ge-grid-item" onClick={() => onOpen(entry)}>
                <span className="ge-grid-icon">
                  {src ? (
                    <img src={src} alt="" draggable={false} />
                  ) : (
                    <span className="ge-grid-letter">{entry.name.slice(0, 1)}</span>
                  )}
                </span>
                <span className="ge-grid-name">{entry.name}</span>
              </button>
              {onForget && (
                <button
                  className="profile-forget"
                  title={`Forget ${entry.name}`}
                  aria-label={`Forget ${entry.name}`}
                  onClick={() => onForget(entry.name)}
                >
                  ×
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
