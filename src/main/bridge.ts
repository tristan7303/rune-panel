/**
 * The RuneLite plugin bridge.
 *
 * A minimal HTTP server on 127.0.0.1 that the companion RuneLite plugin talks
 * to: a wiki-orb lookup in the game POSTs the clicked entity here, "View DPS"
 * POSTs the loadout, and the app opens the matching view over the game.
 * Loopback-bound so nothing on the network can reach it; the plugin is the
 * only intended caller and it, too, only speaks on a user's click.
 *
 * Deliberately not Express or anything like it: four routes and a body cap do
 * not justify a dependency, and the failure behaviour matters more than the
 * routing — a bridge that cannot bind must warn and stay down, never take the
 * app with it.
 *
 * The DPS relay is the one outbound call: the plugin sends the raw loadout and
 * *this* process POSTs it to the wiki's shortlink service, so the plugin's own
 * network egress stays loopback-only — the easiest posture for Plugin Hub
 * review, and one less place that knows the endpoint.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { app } from 'electron'
import * as search from './wiki/search'
import * as titles from './wiki/titles'
import * as client from './wiki/client'
import type { OpenRoute, Settings } from '../shared/ipc'

/** Where the wiki's DPS calculator stores a loadout and hands back an id. */
const SHORTLINK_URL = 'https://tools.runescape.wiki/osrs-dps/shortlink'

/** The shortlink service answers in well under a second; five is a hang. */
const SHORTLINK_TIMEOUT_MS = 5000

/** Bigger than any real loadout by two orders of magnitude. */
const MAX_BODY_BYTES = 64 * 1024

let server: Server | null = null
let boundPort = 0
let routeListener: ((route: OpenRoute) => void) | null = null

/** Main wires this once; the bridge never touches windows itself. */
export function onRoute(cb: (route: OpenRoute) => void): void {
  routeListener = cb
}

/**
 * Bring the server in line with the settings — start, stop, or rebind.
 *
 * Failure to bind (another app on the port) warns and leaves the bridge down.
 * The plugin treats a refused connection as "app not running" and falls back
 * to the browser, which is exactly the right degradation.
 */
export function apply(s: Settings): void {
  if (!s.pluginBridge) {
    stop()
    return
  }
  if (server && boundPort === s.pluginBridgePort) return

  stop()
  const next = createServer((req, res) => {
    void handle(req, res)
  })
  next.on('error', (err) => {
    console.warn('[bridge] not listening:', err instanceof Error ? err.message : err)
    if (server === next) server = null
  })
  next.listen(s.pluginBridgePort, '127.0.0.1', () => {
    console.log(`[bridge] listening on 127.0.0.1:${s.pluginBridgePort}`)
  })
  server = next
  boundPort = s.pluginBridgePort
}

export function stop(): void {
  server?.close()
  server = null
  boundPort = 0
}

/** Loopback in every spelling a socket can report it. */
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Belt and braces with the 127.0.0.1 bind: if the bind ever changes, this
  // check should not have to be remembered.
  if (!LOOPBACK.has(req.socket.remoteAddress ?? '')) {
    req.destroy()
    return
  }

  const path = (req.url ?? '').split('?')[0]

  if (req.method === 'GET' && path === '/ping') {
    return json(res, 200, { app: 'rune-panel', version: app.getVersion() })
  }

  if (req.method !== 'POST' || !['/lookup', '/dps', '/search'].includes(path)) {
    return json(res, 404, { error: 'not-found' })
  }

  // JSON only. A browser can land a cross-origin POST without a preflight so
  // long as the content type is a "simple" one — requiring application/json
  // means any drive-by attempt stops at a preflight nobody answers.
  if (!/^application\/json\b/.test(String(req.headers['content-type'] ?? ''))) {
    return json(res, 415, { error: 'json-only' })
  }

  let raw: string
  try {
    raw = await readBody(req)
  } catch {
    return json(res, 413, { error: 'too-large' })
  }

  let body: unknown
  try {
    body = JSON.parse(raw === '' ? '{}' : raw)
  } catch {
    return json(res, 400, { error: 'bad-json' })
  }

  switch (path) {
    case '/lookup':
      return lookup(res, body)
    case '/dps':
      return dps(res, body, raw)
    case '/search':
      json(res, 200, {})
      routeListener?.({ kind: 'search' })
      return
  }
}

/**
 * An entity clicked in the game, by name.
 *
 * The id and coordinates ride along unused for now — kept in the contract so a
 * future id→title map needs no plugin update. Resolution is strictly exact
 * (against titles and redirects): a fuzzy answer would open the *wrong page
 * over the game*, and the 404 path already ends in the wiki's own id-based
 * lookup in a browser, which cannot miss.
 */
function lookup(res: ServerResponse, body: unknown): void {
  const name = (body as { name?: unknown })?.name
  if (typeof name !== 'string' || !name.trim()) {
    return json(res, 400, { error: 'name-required' })
  }
  // No index yet — first run, mid-setup. Falling back beats guessing.
  if (titles.state().count === 0) {
    return json(res, 404, { error: 'not-found' })
  }

  const title = search.resolveExact(name)
  if (!title) return json(res, 404, { error: 'not-found' })

  json(res, 200, { title })
  routeListener?.({ kind: 'page', title })
}

/**
 * A loadout from the equipment screen, relayed to the wiki's shortlink
 * service. The plugin's bytes are forwarded untouched — this process adds
 * nothing and therefore cannot corrupt a schema it does not own.
 */
async function dps(res: ServerResponse, body: unknown, raw: string): Promise<void> {
  if (!Array.isArray((body as { loadouts?: unknown })?.loadouts)) {
    return json(res, 400, { error: 'loadouts-required' })
  }

  let id: string
  try {
    const relay = await fetch(SHORTLINK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': client.userAgent() },
      body: raw,
      signal: AbortSignal.timeout(SHORTLINK_TIMEOUT_MS),
    })
    if (!relay.ok) throw new Error(`shortlink ${relay.status}`)
    const parsed = (await relay.json()) as { data?: unknown }
    if (typeof parsed.data !== 'string' || !parsed.data) throw new Error('shortlink shape')
    id = parsed.data
  } catch (err) {
    console.warn('[bridge] shortlink relay failed:', err instanceof Error ? err.message : err)
    // No route emit: the plugin does the stock shortlink+browser itself.
    return json(res, 502, { error: 'shortlink-failed' })
  }

  json(res, 200, { id })
  routeListener?.({ kind: 'tool', id: 'dps', arg: id })
}

/** The body, capped while streaming — a hostile writer is cut off, not buffered. */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        req.destroy()
        reject(new Error('body too large'))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}
