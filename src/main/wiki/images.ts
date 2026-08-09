/**
 * The wiki image cache, served over the `rpimg://` protocol.
 *
 * Articles are image-dense in a way that surprises: the Abyssal whip page
 * references 183 of them, nearly all tiny inline item icons. Two consequences
 * shape this file.
 *
 * **Images do not go through the API throttle.** 183 images at the client's
 * 4 req/s ceiling would take 45 seconds to paint one page. That ceiling exists
 * to be gentle with `api.php`, which does real work per call; `/images/` is
 * static bytes behind a CDN, and browsers fetch a hundred of them from any
 * ordinary site without ceremony. This uses a concurrency cap instead — eight
 * at a time, which is roughly what a browser would do anyway.
 *
 * **The cache warms fast.** Skill icons, coin sprites and equipment slots
 * repeat across thousands of pages, so the first article pays and later ones
 * mostly hit disk.
 */

import { app, net, protocol } from 'electron'
import { createHash } from 'crypto'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { join, dirname } from 'path'
import * as db from '../db'
import { userAgent } from './client'

export const SCHEME = 'rpimg'

/**
 * Where a cached image can come from, keyed by the URL's host segment.
 *
 * Two sources, because the wiki does not have everything. The hiscores draw
 * their own boss icons — the ones anyone who has looked at the hiscores already
 * recognises — and the wiki's equivalents are different artwork entirely, often
 * a full monster render where the hiscores use a tight icon.
 *
 * Adding an origin is deliberately this narrow: a fixed allow-list keyed by a
 * host we control, not a URL the renderer passes in. This protocol reaches the
 * network on the renderer's behalf, and one that fetched arbitrary hosts would
 * be a proxy around every protection the sandbox provides.
 */
const ORIGINS: Record<string, string> = {
  img: 'https://oldschool.runescape.wiki/images/',
  hs: 'https://www.runescape.com/img/rsp777/',
  // World map tiles, for the map an infobox carries on a location page. A
  // separate host from the wiki's own images and not reachable under `img`,
  // since the path there is rooted at `/images/`.
  map: 'https://maps.runescape.wiki/',
}
/** Roughly what a browser opens to one host. */
const MAX_CONCURRENT = 8
/** A wiki image that large is a mistake; refuse rather than fill the disk. */
const MAX_BYTES = 12 * 1024 * 1024

let active = 0
const waiting: Array<() => void> = []
/** Concurrent requests for one image share a single download. */
const inFlight = new Map<string, Promise<Buffer | null>>()

/**
 * Register the scheme as privileged.
 *
 * Must happen before `app.ready`, which is why it is separate from `serve()` —
 * Electron cannot upgrade a scheme's privileges after the protocol registry is
 * locked. Without `standard`, relative resolution and CSP `img-src rpimg:`
 * both misbehave.
 */
export function registerScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: false },
    },
  ])
}

/** Install the handler. Call once, after `app.ready`. */
export function serve(): void {
  protocol.handle(SCHEME, async (request) => {
    const ref = decodeName(request.url)
    if (!ref) return new Response('bad image name', { status: 400 })

    try {
      const bytes = await fetchImage(ref)
      if (!bytes) return new Response('not found', { status: 404 })
      return new Response(new Uint8Array(bytes), {
        status: 200,
        headers: {
          'Content-Type': mimeFor(ref.path),
          // Cached on disk by us; letting Chromium hold it in memory too saves
          // a read per repeated icon on a page that uses one 40 times.
          'Cache-Control': 'max-age=86400',
        },
      })
    } catch (err) {
      console.warn(`[images] ${ref.key}:`, err instanceof Error ? err.message : err)
      return new Response('fetch failed', { status: 502 })
    }
  })
}

/**
 * `rpimg://img/Abyssal_whip.png` -> the wiki, `Abyssal_whip.png`.
 * `rpimg://hs/game_icon_nex.png` -> the hiscores, `game_icon_nex.png`.
 *
 * The host names the origin and everything after it is the path. It began as a
 * constant placeholder for a different reason, which still applies: a
 * `standard` scheme parses as `scheme://host/path`, so without something
 * occupying the host, `rpimg://thumb/X.png/130px-X.png` would put `thumb` there
 * — where Chromium lowercases it and the path silently loses a segment.
 * Thumbnails are exactly the case that breaks.
 */
interface ImageRef {
  origin: string
  path: string
  /**
   * Cache key, which the on-disk filename is hashed from.
   *
   * Wiki images keep the bare path they have always used. Qualifying every key
   * with its host would have been tidier and would also have changed every
   * hash, orphaning a cache of thousands of already-downloaded images to
   * re-fetch one at a time. Other origins take an `@host/` prefix, which no
   * MediaWiki path can begin with, so the two can never collide.
   */
  key: string
}

function decodeName(url: string): ImageRef | null {
  try {
    const parsed = new URL(url)
    const origin = ORIGINS[parsed.host]
    if (!origin) return null
    const path = decodeURIComponent(parsed.pathname.replace(/^\//, ''))
    // No traversal, no NUL — this becomes part of a filesystem path.
    if (!path || path.includes('..') || path.includes('\0')) return null
    const key = parsed.host === 'img' ? path : `@${parsed.host}/${path}`
    return { origin, path, key }
  } catch {
    return null
  }
}

/**
 * Percent-encode each path segment, keeping the separators.
 *
 * `encodeURIComponent` on the whole name turns the slashes in
 * `thumb/X.png/130px-X.png` into `%2F` and the request 404s — which is exactly
 * how thumbnails failed the first time.
 */
function encodePath(name: string): string {
  return name.split('/').map(encodeURIComponent).join('/')
}

async function fetchImage(ref: ImageRef): Promise<Buffer | null> {
  const file = cachePath(ref.key)

  try {
    return await readFile(file)
  } catch {
    // Not cached; fall through and download.
  }

  const existing = inFlight.get(ref.key)
  if (existing) return existing

  const job = download(ref, file).finally(() => inFlight.delete(ref.key))
  inFlight.set(ref.key, job)
  return job
}

async function download(ref: ImageRef, file: string): Promise<Buffer | null> {
  await acquire()
  try {
    // Electron's `net` rather than global fetch: it goes through Chromium's
    // stack, so it picks up the system proxy and certificate store.
    const res = await net.fetch(ref.origin + encodePath(ref.path), {
      headers: { 'User-Agent': userAgent() },
    })
    if (!res.ok) return null

    const bytes = Buffer.from(await res.arrayBuffer())
    if (bytes.length === 0 || bytes.length > MAX_BYTES) return null

    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, bytes)

    db.get()
      .prepare(
        `INSERT INTO images (name, ext, fetched_at) VALUES (?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET fetched_at = excluded.fetched_at`
      )
      .run(ref.key, extOf(ref.path), Date.now())

    return bytes
  } finally {
    release()
  }
}

/**
 * Hashed filename, sharded two levels deep.
 *
 * Wiki filenames contain characters Windows rejects outright (`:`, `?`, `"`)
 * and run past the 255-byte limit, so they cannot be used directly. A hash is
 * deterministic, always legal and never collides in practice; the readable name
 * lives in the `images` table. Sharding keeps any one directory from holding
 * the six-figure file count that makes Windows directory listing crawl.
 */
function cachePath(name: string): string {
  const hash = createHash('sha1').update(name).digest('hex')
  return join(app.getPath('userData'), 'images', hash.slice(0, 2), `${hash.slice(2, 22)}.${extOf(name)}`)
}

function extOf(name: string): string {
  const match = /\.([a-z0-9]{2,4})$/i.exec(name)
  return match ? match[1].toLowerCase() : 'png'
}

function mimeFor(name: string): string {
  switch (extOf(name)) {
    case 'svg':
      return 'image/svg+xml'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'gif':
      return 'image/gif'
    case 'webp':
      return 'image/webp'
    default:
      return 'image/png'
  }
}

function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active++
    return Promise.resolve()
  }
  return new Promise((resolve) => waiting.push(resolve))
}

function release(): void {
  const next = waiting.shift()
  if (next) next()
  else active--
}
