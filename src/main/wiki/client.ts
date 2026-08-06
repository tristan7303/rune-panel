/**
 * The one place any outbound request happens.
 *
 * The OSRS Wiki does not rate limit and says so, but it does ask automated
 * clients to identify themselves and to be reasonable — and it pre-emptively
 * blocks some default user agents. Politeness here is self-imposed rather than
 * enforced, which is exactly why it belongs in a single choke point instead of
 * being re-decided at each call site:
 *
 *  - one descriptive User-Agent, with a contact address from settings
 *  - a serial queue holding the whole app to 4 requests a second
 *  - interactive work jumps ahead of the background crawler
 *  - identical in-flight requests share one promise
 *  - retries honour Retry-After and back off on 429/5xx
 *  - `maxlag` lets the server itself tell us to slow down
 *
 * The price API shares this queue despite being a different service. One global
 * ceiling is stricter than either host needs, but a background crawl can never
 * then starve or outpace anything, and prices are fetched at interactive
 * priority so they jump the line anyway.
 */

export const API = 'https://oldschool.runescape.wiki/api.php'

/** 4 requests a second. Self-imposed; the wiki asks for reasonable, not exact. */
const MIN_INTERVAL_MS = 250
const MAX_ATTEMPTS = 4
/** Cap a server-supplied Retry-After so a bad header cannot wedge the queue. */
const MAX_BACKOFF_MS = 30_000

export type Priority = 'interactive' | 'background'

export interface ClientStats {
  sent: number
  ok: number
  retried: number
  failed: number
  queued: number
}

interface Job {
  url: string
  priority: Priority
  resolve: (value: unknown) => void
  reject: (err: unknown) => void
}

const queues: Record<Priority, Job[]> = { interactive: [], background: [] }
const inFlight = new Map<string, Promise<unknown>>()
const stats: ClientStats = { sent: 0, ok: 0, retried: 0, failed: 0, queued: 0 }

let contact = ''
let pumping = false
let lastSentAt = 0

/** Called at startup and whenever settings change. */
export function configure(options: { contact: string }): void {
  contact = options.contact.trim()
}

export function userAgent(): string {
  // An unset contact is still identifiable — the wiki's actual objection is to
  // anonymous library defaults like `python-requests`, not to missing email.
  return `rune-buddy/0.1 (personal OSRS desktop tool; ${contact ? `contact: ${contact}` : 'no contact configured'})`
}

export function getStats(): ClientStats {
  return { ...stats, queued: queues.interactive.length + queues.background.length }
}

export function resetStats(): void {
  stats.sent = 0
  stats.ok = 0
  stats.retried = 0
  stats.failed = 0
}

/** A MediaWiki api.php call. Params are merged over the standard set. */
export function query<T>(
  params: Record<string, string | number>,
  priority: Priority = 'interactive'
): Promise<T> {
  const search = new URLSearchParams({
    format: 'json',
    formatversion: '2',
    // Ask the server to refuse us rather than serve stale data while it is
    // struggling. It answers with a `maxlag` error and a Retry-After, which the
    // retry path below understands.
    maxlag: '5',
    ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
  })
  return request<T>(`${API}?${search}`, priority)
}

/** A plain JSON GET, for the price API and other non-MediaWiki endpoints. */
export function getJson<T>(url: string, priority: Priority = 'interactive'): Promise<T> {
  return request<T>(url, priority)
}

function request<T>(url: string, priority: Priority): Promise<T> {
  // Two views opening on the same item should cost one request, not two.
  const existing = inFlight.get(url)
  if (existing) return existing as Promise<T>

  const promise = new Promise<T>((resolve, reject) => {
    queues[priority].push({ url, priority, resolve: resolve as (v: unknown) => void, reject })
  }).finally(() => inFlight.delete(url))

  inFlight.set(url, promise)
  void pump()
  return promise
}

async function pump(): Promise<void> {
  if (pumping) return
  pumping = true
  try {
    for (;;) {
      const job = queues.interactive.shift() ?? queues.background.shift()
      if (!job) break
      try {
        job.resolve(await send(job.url))
      } catch (err) {
        job.reject(err)
      }
    }
  } finally {
    pumping = false
  }
}

/**
 * Issue one request, retrying in place.
 *
 * Retrying inside the send rather than by re-queueing is deliberate: a backoff
 * should stall the entire queue. If the server is asking for room, giving it
 * room on one request while firing the next four is not backing off.
 */
async function send(url: string): Promise<unknown> {
  let lastError: unknown

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) stats.retried++
    await throttle()

    try {
      stats.sent++
      const res = await fetch(url, {
        headers: { 'User-Agent': userAgent(), Accept: 'application/json' },
      })

      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(`HTTP ${res.status} ${res.statusText}`)
        await backoff(attempt, res.headers.get('retry-after'))
        continue
      }
      if (!res.ok) {
        // 400s are our fault — a bad title, a malformed param. Retrying just
        // makes the same mistake more often.
        throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`)
      }

      const body = (await res.json()) as Record<string, unknown>

      // MediaWiki reports failure inside a 200. `maxlag` is the server asking
      // for room and is the one error worth retrying.
      const error = body.error as { code?: string; info?: string } | undefined
      if (error) {
        if (error.code === 'maxlag') {
          lastError = new Error(`maxlag: ${error.info ?? ''}`)
          await backoff(attempt, res.headers.get('retry-after'))
          continue
        }
        throw new Error(`wiki API error ${error.code ?? '?'}: ${error.info ?? 'no detail'}`)
      }

      stats.ok++
      return body
    } catch (err) {
      // A thrown Error from the two branches above is final; anything else is a
      // transport failure worth another go.
      if (err instanceof Error && err.message.startsWith('HTTP 4')) {
        stats.failed++
        throw err
      }
      if (err instanceof Error && err.message.startsWith('wiki API error')) {
        stats.failed++
        throw err
      }
      lastError = err
      await backoff(attempt, null)
    }
  }

  stats.failed++
  throw new Error(
    `gave up after ${MAX_ATTEMPTS} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`
  )
}

/** Hold the global rate ceiling, with jitter so bursts do not re-synchronise. */
async function throttle(): Promise<void> {
  const wait = MIN_INTERVAL_MS - (Date.now() - lastSentAt) + Math.random() * 40
  if (wait > 0) await sleep(wait)
  lastSentAt = Date.now()
}

async function backoff(attempt: number, retryAfter: string | null): Promise<void> {
  const header = retryAfter ? Number(retryAfter) * 1000 : NaN
  const delay = Number.isFinite(header)
    ? Math.min(header, MAX_BACKOFF_MS)
    : Math.min(500 * 2 ** attempt + Math.random() * 250, MAX_BACKOFF_MS)
  await sleep(delay)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
