/**
 * Grand Exchange.
 *
 * Item search, the numbers that matter for flipping, and price history. Search
 * reuses the wiki title index rather than a separate item index — you already
 * type item names there, and every tradeable item has an article, so an item
 * lookup is a wiki lookup that happens to resolve to a price.
 */

import { useEffect, useMemo, useState, type JSX } from 'react'
import type { GeItemDetail, GeTimestep, SearchResult, Theme } from '@shared/ipc'
import { useStore } from './store'
import { useNav } from './nav'
import { PriceChart, SERIES, chartMode, fmt } from './PriceChart'
import { CoinsIcon, SearchIcon } from './icons'
import { usePrimaryInput } from './focus'

export function Grand({ itemId }: { itemId?: number }): JSX.Element {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [selected, setSelected] = useState(0)
  const [detail, setDetail] = useState<GeItemDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [timestep, setTimestep] = useState<GeTimestep>('6h')
  const theme = useStore((s) => s.settings?.theme ?? 'dark')
  const replace = useNav((s) => s.replace)
  const inputRef = usePrimaryInput()

  useEffect(() => {
    if (itemId === undefined) return
    setLoading(true)
    setError(null)
    window.rp
      .geDetail(itemId, timestep)
      .then((d) => {
        if (!d) setError('That item is not tradeable, or is not in the price list.')
        setDetail(d)
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [itemId, timestep])

  useEffect(() => {
    setSelected(0)
    if (query.trim().length < 2) return setResults([])
    let live = true
    void window.rp.geSearch(query).then((hits) => {
      if (!live) return
      setResults(hits.slice(0, 12))
      setSelected(0)
    })
    return () => {
      live = false
    }
  }, [query])

  /** Resolve a wiki title to an item id, then route to it. */
  const open = async (title: string): Promise<void> => {
    setError(null)
    const item = await window.rp.geFindByName(title)
    if (!item) {
      setError(`“${title}” is not a tradeable item.`)
      return
    }
    setQuery('')
    setResults([])
    replace({ kind: 'ge', itemId: item.id })
  }

  // The search bar stays mounted above whatever is showing. Having to navigate
  // back to reach it made switching items feel like leaving the view and
  // returning to it, when it is really one continuous task.
  return (
    <div className="ge">
      <div className="ge-searchbar">
        <div className="search-field">
          <SearchIcon />
          <input
            // Focus is driven from the route change rather than `autoFocus`,
            // which fires on mount — and this remounts on every item, so it
            // used to pull the caret back here each time you picked a result.
            ref={inputRef}
            type="text"
            className="search-input"
            placeholder="Find an item…"
            spellCheck={false}
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            // Same keyboard contract as the wiki search in the header: arrows
            // move the highlight, Enter takes it. Typing an item name and
            // pressing Enter should never need a look at the screen.
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
          <ul className="results ge-results" role="listbox">
            {results.map((r, i) => (
              <li
                key={r.title}
                role="option"
                aria-selected={i === selected}
                className={`result ${i === selected ? 'is-selected' : ''}`}
                // The highlight follows the pointer, so mousing over a row and
                // pressing Enter opens the row you are looking at rather than
                // the one the keyboard last left behind.
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

      {error && <p className="profile-error">{error}</p>}

      {loading && <div className="placeholder">Loading prices…</div>}

      {!loading && detail && (
        <ItemView detail={detail} theme={theme} timestep={timestep} onTimestep={setTimestep} />
      )}

      {!loading && !detail && !error && (
        <div className="ge-hero">
          <CoinsIcon />
          <h1>Grand Exchange</h1>
          <p>Live buy and sell prices, margins and history, from the real-time price feed.</p>
        </div>
      )}
    </div>
  )
}

/** Ranges the price API offers, shortest first. */
const RANGES: Array<{ step: GeTimestep; label: string; hint: string }> = [
  { step: '5m', label: '1D', hint: '5-minute buckets, about a day' },
  { step: '1h', label: '2W', hint: 'Hourly buckets, about two weeks' },
  { step: '6h', label: '3M', hint: '6-hour buckets, about three months' },
  { step: '24h', label: '1Y', hint: 'Daily buckets, about a year' },
]

function ItemView({
  detail,
  theme,
  timestep,
  onTimestep,
}: {
  detail: GeItemDetail
  theme: Theme
  timestep: GeTimestep
  onTimestep: (t: GeTimestep) => void
}): JSX.Element {
  const { item, price, margin, potentialProfit } = detail
  const push = useNav((s) => s.push)

  // The GE takes 2% of the sale price, capped, on most items above 50 gp. Shown
  // separately from the raw margin rather than folded into it, because every
  // other tool quotes the raw number and a silently different figure is worse
  // than an extra row.
  const tax = useMemo(() => (price?.high ? Math.min(Math.floor(price.high * 0.02), 5_000_000) : null), [price])
  const netMargin = margin !== null && tax !== null ? margin - tax : null

  return (
    <div className="ge-item">
      <div className="ge-item-head">
        <h1>{item.name}</h1>
        <button className="link-btn" onClick={() => push({ kind: 'page', title: item.name })}>
          wiki article
        </button>
      </div>

      {item.examine && <p className="ge-examine">{item.examine}</p>}

      <div className="stat-row">
        <Stat label="Buy" value={price?.high != null ? fmt(price.high) : '—'} rule={SERIES[chartMode(theme)].buy} />
        <Stat label="Sell" value={price?.low != null ? fmt(price.low) : '—'} rule={SERIES[chartMode(theme)].sell} />
        <Stat label="Margin" value={margin !== null ? fmt(margin) : '—'} />
        <Stat label="After tax" value={netMargin !== null ? fmt(netMargin) : '—'} />
        <Stat label="Buy limit" value={item.buyLimit ? item.buyLimit.toLocaleString() : '—'} />
        <Stat
          label="Limit profit"
          value={potentialProfit !== null ? fmt(potentialProfit) : '—'}
          hint="Margin across a full buy limit, before tax"
        />
        <Stat label="High alch" value={item.highalch ? fmt(item.highalch) : '—'} />
      </div>

      <div className="chart-head">
        <h2>Price history</h2>
        {/* The API returns a fixed number of buckets per step, so the range and
            the resolution are the same control — a shorter range is finer
            grained, not a zoom on the same data. */}
        <div className="range-tabs" role="tablist">
          {RANGES.map((r) => (
            <button
              key={r.step}
              role="tab"
              aria-selected={r.step === timestep}
              title={r.hint}
              className={`range-tab ${r.step === timestep ? 'is-active' : ''}`}
              onClick={() => onTimestep(r.step)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <PriceChart series={detail.series} theme={theme} />

      {price && (
        <p className="ge-updated">
          Prices updated {relative(price.updatedAt)}
          {price.highTime ? ` · last buy ${relative(price.highTime * 1000)}` : ''}
          {price.lowTime ? ` · last sell ${relative(price.lowTime * 1000)}` : ''}
        </p>
      )}
    </div>
  )
}

function Stat({
  label,
  value,
  rule,
  hint,
}: {
  label: string
  value: string
  /** Series colour, when this tile corresponds to a line on the chart. */
  rule?: string
  hint?: string
}): JSX.Element {
  return (
    <div className="stat" title={hint}>
      <span className="stat-label">{label}</span>
      {/* The number wears a text token. The series colour appears only as a rule
          beside it, taken from the chart's own validated palette so the tile and
          the line cannot drift apart. */}
      <span
        className={`stat-value ${rule ? 'has-rule' : ''}`}
        style={rule ? { borderLeftColor: rule } : undefined}
      >
        {value}
      </span>
    </div>
  )
}

function relative(epochMs: number): string {
  const secs = Math.max(0, Math.round((Date.now() - epochMs) / 1000))
  if (secs < 90) return `${secs}s ago`
  const mins = Math.round(secs / 60)
  if (mins < 90) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 36) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}
