/**
 * Grand Exchange prices.
 *
 * Three endpoints, each with a different cost and cadence, which is what shapes
 * this file:
 *
 *  - `/mapping` is every tradeable item's metadata — 4,652 of them in one
 *    862 KB response. Fetched once and stored; it only changes when Jagex adds
 *    an item.
 *  - `/latest` is the current buy and sell for *every* item, also one request.
 *    That is the important property: there is never a reason to ask about one
 *    item, so the whole table is refreshed at once and read from disk.
 *  - `/timeseries` is per-item history and the only per-item call, so it is
 *    fetched on demand and cached briefly.
 *
 * GE-Tracker was the alternative for prices. Its API is premium-only and
 * currently closed to new keys, and its numbers derive from the same RuneLite
 * feed as this one, so there is nothing to gain.
 */

import * as db from '../db'
import * as client from '../wiki/client'

const API = 'https://prices.runescape.wiki/api/v1/osrs'

const KEY_MAPPING_AT = 'ge.mapping_at'
const KEY_LATEST_AT = 'ge.latest_at'

/** Item metadata changes only when Jagex ships an item. */
const MAPPING_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
/**
 * Prices update continuously, but the upstream feed itself aggregates, so
 * asking more often than once a minute returns the same numbers.
 */
const LATEST_MAX_AGE_MS = 60 * 1000
const SERIES_MAX_AGE_MS = 10 * 60 * 1000

export interface Item {
  id: number
  name: string
  examine: string | null
  members: boolean
  buyLimit: number | null
  value: number | null
  highalch: number | null
  icon: string | null
}

export interface Price {
  itemId: number
  /** Instant-buy price: what someone just paid. */
  high: number | null
  highTime: number | null
  /** Instant-sell price: what someone just accepted. */
  low: number | null
  lowTime: number | null
  updatedAt: number
}

export interface SeriesPoint {
  ts: number
  avgHigh: number | null
  avgLow: number | null
  volHigh: number
  volLow: number
}

export type Timestep = '5m' | '1h' | '6h' | '24h'

/** Everything the item view needs, in one call. */
export interface ItemDetail {
  item: Item
  price: Price | null
  /** Buy minus sell, before tax. Null when either side is unknown. */
  margin: number | null
  /** Total gp if you bought and flipped a full buy limit. */
  potentialProfit: number | null
  series: SeriesPoint[]
}

// ── mapping ─────────────────────────────────────────────────────────────────

interface MappingRow {
  id: number
  name: string
  examine?: string
  members?: boolean
  limit?: number
  value?: number
  highalch?: number
  icon?: string
}

export async function syncMapping(force = false): Promise<number> {
  const at = db.kvGetNumber(KEY_MAPPING_AT)
  if (!force && at !== null && Date.now() - at < MAPPING_MAX_AGE_MS) {
    return countItems()
  }

  const rows = await client.getJson<MappingRow[]>(`${API}/mapping`, 'background')
  const d = db.get()
  const insert = d.prepare(
    `INSERT INTO items (id, name, examine, members, buy_limit, value, highalch, icon)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name, examine = excluded.examine, members = excluded.members,
       buy_limit = excluded.buy_limit, value = excluded.value,
       highalch = excluded.highalch, icon = excluded.icon`
  )

  // One transaction: 4,652 individual commits would take minutes.
  d.exec('BEGIN')
  try {
    for (const r of rows) {
      insert.run(
        r.id,
        r.name,
        r.examine ?? null,
        r.members ? 1 : 0,
        r.limit ?? null,
        r.value ?? null,
        r.highalch ?? null,
        r.icon ?? null
      )
    }
    d.exec('COMMIT')
  } catch (err) {
    d.exec('ROLLBACK')
    throw err
  }

  db.kvSet(KEY_MAPPING_AT, Date.now())
  return rows.length
}

function countItems(): number {
  return (db.get().prepare('SELECT COUNT(*) AS n FROM items').get() as { n: number }).n
}

// ── latest ──────────────────────────────────────────────────────────────────

interface LatestResponse {
  data: Record<string, { high?: number | null; highTime?: number | null; low?: number | null; lowTime?: number | null }>
}

/**
 * Refresh every price in one request.
 *
 * Deliberately all-or-nothing. The endpoint returns the full table whatever you
 * ask for, so per-item fetching would be strictly more requests for strictly
 * less data.
 */
export async function syncLatest(force = false): Promise<number> {
  const at = db.kvGetNumber(KEY_LATEST_AT)
  if (!force && at !== null && Date.now() - at < LATEST_MAX_AGE_MS) return 0

  const body = await client.getJson<LatestResponse>(`${API}/latest`, 'interactive')
  const now = Date.now()
  const d = db.get()
  const insert = d.prepare(
    `INSERT INTO prices (item_id, high, high_time, low, low_time, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(item_id) DO UPDATE SET
       high = excluded.high, high_time = excluded.high_time,
       low = excluded.low, low_time = excluded.low_time,
       updated_at = excluded.updated_at`
  )

  let count = 0
  d.exec('BEGIN')
  try {
    for (const [id, p] of Object.entries(body.data)) {
      insert.run(Number(id), p.high ?? null, p.highTime ?? null, p.low ?? null, p.lowTime ?? null, now)
      count++
    }
    d.exec('COMMIT')
  } catch (err) {
    d.exec('ROLLBACK')
    throw err
  }

  db.kvSet(KEY_LATEST_AT, now)
  return count
}

// ── timeseries ──────────────────────────────────────────────────────────────

interface SeriesResponse {
  data: Array<{
    timestamp: number
    avgHighPrice: number | null
    avgLowPrice: number | null
    highPriceVolume: number
    lowPriceVolume: number
  }>
}

async function series(itemId: number, timestep: Timestep): Promise<SeriesPoint[]> {
  const cached = db
    .get()
    .prepare('SELECT MAX(ts) AS newest, COUNT(*) AS n FROM price_series WHERE item_id = ?')
    .get(itemId) as { newest: number | null; n: number }

  // `ts` is upstream's own bucket timestamp in seconds, so freshness is judged
  // against the newest bucket rather than when we happened to fetch it.
  const freshEnough =
    cached.n > 0 && cached.newest !== null && Date.now() - cached.newest * 1000 < SERIES_MAX_AGE_MS
  if (freshEnough) return readSeries(itemId)

  const body = await client.getJson<SeriesResponse>(
    `${API}/timeseries?id=${itemId}&timestep=${timestep}`,
    'interactive'
  )

  const d = db.get()
  const insert = d.prepare(
    `INSERT INTO price_series (item_id, ts, avg_high, avg_low, vol_high, vol_low)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(item_id, ts) DO UPDATE SET
       avg_high = excluded.avg_high, avg_low = excluded.avg_low,
       vol_high = excluded.vol_high, vol_low = excluded.vol_low`
  )
  d.exec('BEGIN')
  try {
    for (const p of body.data) {
      insert.run(itemId, p.timestamp, p.avgHighPrice, p.avgLowPrice, p.highPriceVolume, p.lowPriceVolume)
    }
    d.exec('COMMIT')
  } catch (err) {
    d.exec('ROLLBACK')
    throw err
  }

  return readSeries(itemId)
}

function readSeries(itemId: number): SeriesPoint[] {
  return (
    db
      .get()
      .prepare(
        'SELECT ts, avg_high, avg_low, vol_high, vol_low FROM price_series WHERE item_id = ? ORDER BY ts'
      )
      .all(itemId) as Array<{
      ts: number
      avg_high: number | null
      avg_low: number | null
      vol_high: number
      vol_low: number
    }>
  ).map((r) => ({
    ts: r.ts,
    avgHigh: r.avg_high,
    avgLow: r.avg_low,
    volHigh: r.vol_high,
    volLow: r.vol_low,
  }))
}

// ── reads ───────────────────────────────────────────────────────────────────

export function findItemByName(name: string): Item | null {
  const row = db
    .get()
    .prepare('SELECT * FROM items WHERE name = ? COLLATE NOCASE')
    .get(name) as ItemRow | undefined
  return row ? toItem(row) : null
}

/**
 * Everything the item view needs.
 *
 * Prices are refreshed opportunistically here rather than on a timer: the only
 * moment they matter is when someone is looking, and `/latest` covers every
 * item at once so one view's refresh serves the whole app.
 */
export async function detail(itemId: number, timestep: Timestep = '6h'): Promise<ItemDetail | null> {
  await syncMapping()

  const row = db.get().prepare('SELECT * FROM items WHERE id = ?').get(itemId) as ItemRow | undefined
  if (!row) return null

  await syncLatest().catch(() => {
    // Stale prices still beat an error page; the timestamp shown says how old.
  })

  const item = toItem(row)
  const price = readPrice(itemId)
  const points = await series(itemId, timestep).catch(() => [] as SeriesPoint[])

  // Margin is quoted before the Grand Exchange's 2% sell tax, matching how the
  // wiki and every flipping site quote it. Tax is applied per-item at sale and
  // capped, which is more than a header line should try to model.
  const margin = price?.high != null && price.low != null ? price.high - price.low : null

  return {
    item,
    price,
    margin,
    potentialProfit: margin !== null && item.buyLimit ? margin * item.buyLimit : null,
    series: points,
  }
}

export function readPrice(itemId: number): Price | null {
  const row = db.get().prepare('SELECT * FROM prices WHERE item_id = ?').get(itemId) as
    | { item_id: number; high: number | null; high_time: number | null; low: number | null; low_time: number | null; updated_at: number }
    | undefined
  if (!row) return null
  return {
    itemId: row.item_id,
    high: row.high,
    highTime: row.high_time,
    low: row.low,
    lowTime: row.low_time,
    updatedAt: row.updated_at,
  }
}

interface ItemRow {
  id: number
  name: string
  examine: string | null
  members: number
  buy_limit: number | null
  value: number | null
  highalch: number | null
  icon: string | null
}

function toItem(r: ItemRow): Item {
  return {
    id: r.id,
    name: r.name,
    examine: r.examine,
    members: r.members === 1,
    buyLimit: r.buy_limit,
    value: r.value,
    highalch: r.highalch,
    icon: r.icon,
  }
}
