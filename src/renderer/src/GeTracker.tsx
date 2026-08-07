/**
 * GE Tracker, with a native way in.
 *
 * Their site is the point — live margins, volumes and price history that this
 * app does not compute — and their API is paid, so the page is embedded rather
 * than reimplemented. Same bargain as the DPS calculator and RuneProfile.
 *
 * What is ours is the search. Their item lookup means clicking into their nav,
 * typing, and reading a dropdown, which is three interactions inside an embedded
 * view to answer "what is a tbow going for". This box sits above the pane and
 * jumps straight to the item, using the item index the app already holds for the
 * Grand Exchange page — so it matches the same names, with the same spelling,
 * as everything else here.
 *
 * The pane loads immediately rather than waiting for a search. Unlike
 * RuneProfile, whose page is meaningless without a username, GE Tracker's front
 * page is a useful thing to land on.
 */

import { useEffect, useRef, useState, type JSX } from 'react'
import { ToolPane } from './ToolPane'
import { SearchIcon } from './icons'
import { usePrimaryInput } from './focus'

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
  const [slug, setSlug] = useState<string | undefined>(undefined)
  const [showing, setShowing] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = usePrimaryInput()
  const live = useRef(true)

  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])

  /**
   * Resolve what was typed against the app's own item list before navigating.
   *
   * A slug built from a typo is a 404 inside someone else's page, several
   * seconds later, with no obvious way back — the same reason the RuneProfile
   * page checks a username before loading the pane.
   */
  const look = async (name: string): Promise<void> => {
    const trimmed = name.trim()
    if (!trimmed || busy) return
    setBusy(true)
    setError(null)
    try {
      const found = await window.rp.geFindByName(trimmed)
      if (!live.current) return
      if (!found) {
        setError(`No item called “${trimmed}”.`)
        return
      }
      // Their spelling, not the typed one — it is what the slug has to match.
      setSlug(itemSlug(found.name))
      setShowing(found.name)
      setQuery('')
    } catch (err) {
      if (live.current) setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (live.current) setBusy(false)
    }
  }

  return (
    <div className="tool-host">
      <div className="tool-bar">
        <form
          className="ge-tracker-form"
          onSubmit={(e) => {
            e.preventDefault()
            void look(query)
          }}
        >
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
            />
          </div>
          <button type="submit" className="btn" disabled={busy || !query.trim()}>
            {busy ? 'Looking up…' : 'Look up'}
          </button>
        </form>

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
