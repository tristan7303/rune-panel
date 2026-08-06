/**
 * Grand Exchange.
 *
 * Item search, the numbers that matter for flipping, and price history. Search
 * reuses the wiki title index rather than a separate item index — you already
 * type item names there, and every tradeable item has an article, so an item
 * lookup is a wiki lookup that happens to resolve to a price.
 */

import { useEffect, useMemo, useState, type JSX } from 'react'
import type { GeItemDetail, SearchResult } from '@shared/ipc'
import { useStore } from './store'
import { useNav } from './nav'
import { PriceChart, SERIES, fmt } from './PriceChart'
import { CoinsIcon, SearchIcon } from './icons'

export function Grand({ itemId }: { itemId?: number }): JSX.Element {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [detail, setDetail] = useState<GeItemDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const theme = useStore((s) => s.settings?.theme ?? 'dark')
  const replace = useNav((s) => s.replace)

  useEffect(() => {
    if (itemId === undefined) return
    setLoading(true)
    setError(null)
    window.rp
      .geDetail(itemId)
      .then((d) => {
        if (!d) setError('That item is not tradeable, or is not in the price list.')
        setDetail(d)
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [itemId])

  useEffect(() => {
    if (query.trim().length < 2) return setResults([])
    let live = true
    void window.rp.search(query).then((hits) => {
      if (live) setResults(hits.slice(0, 12))
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

  if (itemId === undefined || (!detail && !loading && !error)) {
    return (
      <div className="ge-search">
        <div className="ge-hero">
          <CoinsIcon />
          <h1>Grand Exchange</h1>
          <p>Live buy and sell prices, margins and history, from the real-time price feed.</p>
        </div>
        <div className="search-field">
          <SearchIcon />
          <input
            type="text"
            className="search-input"
            placeholder="Find an item…"
            spellCheck={false}
            autoComplete="off"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && results[0]) void open(results[0].title)
            }}
          />
        </div>
        {error && <p className="profile-error">{error}</p>}
        {results.length > 0 && (
          <ul className="results">
            {results.map((r) => (
              <li key={r.title} className="result" onClick={() => void open(r.title)}>
                <span className="result-title">{r.title}</span>
                {r.matchedVia && <span className="result-alias">matched “{r.matchedVia}”</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  if (loading) return <div className="placeholder">Loading prices…</div>
  if (error) {
    return (
      <div className="placeholder">
        <h2>Grand Exchange</h2>
        <p>{error}</p>
      </div>
    )
  }
  if (!detail) return <div className="placeholder">Nothing to show.</div>

  return <ItemView detail={detail} theme={theme} onBack={() => replace({ kind: 'ge' })} />
}

function ItemView({
  detail,
  theme,
  onBack,
}: {
  detail: GeItemDetail
  theme: 'dark' | 'light'
  onBack: () => void
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
        <button className="btn" onClick={onBack}>
          ← Another item
        </button>
        <h1>{item.name}</h1>
        <button className="link-btn" onClick={() => push({ kind: 'page', title: item.name })}>
          wiki article
        </button>
      </div>

      {item.examine && <p className="ge-examine">{item.examine}</p>}

      <div className="stat-row">
        <Stat label="Buy" value={price?.high != null ? fmt(price.high) : '—'} rule={SERIES[theme].buy} />
        <Stat label="Sell" value={price?.low != null ? fmt(price.low) : '—'} rule={SERIES[theme].sell} />
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
