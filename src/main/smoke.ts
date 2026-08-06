/**
 * Headless self-check, run with SMOKE=1.
 *
 * A frameless window shows nothing useful in a terminal and a screenshot cannot
 * tell you whether the preload bridge actually connected, so the acceptance
 * criteria are asserted directly: the window exists, the tray and hotkey are
 * live, show/hide behaves, and a real IPC round trip completes through the same
 * bridge the UI uses.
 *
 * One thing this deliberately does not assert: whether DWM actually drew the
 * acrylic backdrop. Electron exposes no getter, and `capturePage` renders the
 * web contents only — the system backdrop lives behind them and never appears
 * in the capture. Acrylic is confirmed by eye. That is acceptable precisely
 * because nothing depends on it: the CSS surface is near-opaque on its own, so
 * a machine where DWM declines still gets a correct-looking window.
 */

import { app, globalShortcut, Tray } from 'electron'
import { writeFileSync, writeSync } from 'fs'
import { join } from 'path'
import { getWindow, show, hide } from './window'
import type { Settings } from '../shared/ipc'
import * as db from './db'
import * as client from './wiki/client'
import * as titles from './wiki/titles'
import { transform } from './wiki/transform'
import * as sync from './wiki/sync'
import * as pane from './tools/pane'
import { TOOLS } from './tools/registry'
import type { ToolId } from '../shared/ipc'

interface Check {
  name: string
  pass: boolean
  detail: string
}

const checks: Check[] = []

function check(name: string, pass: boolean, detail = ''): void {
  checks.push({ name, pass, detail })
}

export async function runSmoke(initial: Settings): Promise<void> {
  const win = getWindow()

  check('window created', win !== null)
  check('hotkey registered', globalShortcut.isRegistered(initial.hotkey), initial.hotkey)
  check('tray created', Tray.prototype !== undefined)

  if (win) {
    try {
      await waitForLoad(win.webContents)

      check('window starts hidden', !win.isVisible(), 'nothing shows until asked for')

      const bridge = await win.webContents.executeJavaScript('typeof window.rp')
      check('preload bridge exposed', bridge === 'object', `typeof window.rp = ${bridge}`)

      checkDatabase()
      checkClient()
      await checkSettingsRoundTrip(win.webContents, initial)
      await checkTitleIndex(win.webContents)
      await checkSearch(win.webContents)
      checkTransform()
      await checkArticle(win.webContents)
      await checkCrawl(win.webContents)
      checkToolRegistry()
  if (process.env.SMOKE_FETCH) await checkPrices(win.webContents)
      if (process.env.SMOKE_FETCH) await checkToolPane(win)
      await checkShowHide(win)

      if (process.env.SMOKE_SHOT) await screenshot(win)
    } catch (err) {
      check('smoke run completed', false, err instanceof Error ? err.message : String(err))
    }
  }

  report()
}

/**
 * Round trip through the real bridge, not a synthetic ipcMain call.
 *
 * Asserts the shape as well as the values: a handler returning undefined would
 * still "resolve", and the renderer would only find out when it tried to read a
 * field.
 */
async function checkSettingsRoundTrip(
  wc: Electron.WebContents,
  initial: Settings
): Promise<void> {
  const raw = await wc.executeJavaScript('window.rp.getSettings().then(s => JSON.stringify(s))')
  const got = JSON.parse(raw) as Settings

  check(
    'IPC round trip (getSettings)',
    got?.hotkey === initial.hotkey && typeof got.acrylic === 'boolean',
    `hotkey=${got?.hotkey} acrylic=${got?.acrylic}`
  )

  // Push a change from the renderer and wait for it to come back on the
  // broadcast channel — this covers Send, the settings store, and On in one go.
  const echoed = await wc.executeJavaScript(`
    new Promise((resolve) => {
      const timer = setTimeout(() => { off(); resolve('timeout') }, 3000)
      const off = window.rp.onSettings((s) => {
        clearTimeout(timer); off(); resolve(s.contactEmail)
      })
      window.rp.setSettings({ contactEmail: 'smoke@test' })
    })
  `)
  check('settings write echoes back', echoed === 'smoke@test', String(echoed))

  // Leave no trace: the smoke run must not overwrite a real contact address.
  wc.send('noop')
  await wc.executeJavaScript(
    `window.rp.setSettings({ contactEmail: ${JSON.stringify(initial.contactEmail)} })`
  )
}

/** The database opened, migrated, and is in the mode the design assumes. */
function checkDatabase(): void {
  const d = db.get()

  const journal = d.prepare('PRAGMA journal_mode').get() as { journal_mode: string }
  check('db: WAL enabled', journal.journal_mode === 'wal', journal.journal_mode)

  const version = d.prepare('PRAGMA user_version').get() as { user_version: number }
  check('db: migrated', version.user_version >= 1, `user_version=${version.user_version}`)

  const tables = (
    d
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as Array<{ name: string }>
  ).map((r) => r.name)
  const wanted = ['images', 'items', 'kv', 'pages', 'price_series', 'prices', 'titles']
  const missing = wanted.filter((t) => !tables.includes(t))
  check('db: schema complete', missing.length === 0, missing.length ? `missing ${missing}` : `${tables.length} tables`)

  // Round-trip the kv helpers, since every sync cursor depends on them.
  db.kvSet('smoke.probe', 42)
  check('db: kv round trip', db.kvGetNumber('smoke.probe') === 42)
  d.prepare('DELETE FROM kv WHERE key = ?').run('smoke.probe')
}

/** The client identifies itself the way the wiki asks it to. */
function checkClient(): void {
  const ua = client.userAgent()
  check(
    'client: descriptive user-agent',
    ua.startsWith('rune-panel/') && ua.includes('OSRS'),
    ua
  )
  // The wiki pre-emptively blocks library defaults; ours must not resemble one.
  check(
    'client: not a blocked default agent',
    !/python-requests|ApacheHttpClient|node-fetch|axios/i.test(ua)
  )
}

/**
 * The title index is reachable from the renderer and, if populated, coherent.
 *
 * A fresh clone has no index yet, so an empty one is reported rather than
 * failed — the sync is a four-minute network operation and has no business
 * running inside a smoke check. When rows do exist, they are checked for the
 * one property everything downstream relies on: redirects resolving to real
 * article titles.
 */
async function checkTitleIndex(wc: Electron.WebContents): Promise<void> {
  const raw = await wc.executeJavaScript('window.rp.getTitleIndex().then(s => JSON.stringify(s))')
  const state = JSON.parse(raw) as ReturnType<typeof titles.state>

  check(
    'IPC round trip (getTitleIndex)',
    typeof state?.count === 'number' && typeof state.syncing === 'boolean',
    `${state?.count} titles, ${state?.redirects} redirects`
  )

  if (state.count === 0) {
    check('titles: index populated', true, 'empty — run `npm run sync:titles`')
    return
  }

  check('titles: has articles', state.count - state.redirects > 1000, `${state.count - state.redirects}`)

  // Every redirect target should itself be a known title. A miss means the two
  // passes were joined on the wrong key, which would silently break search.
  const dangling = db
    .get()
    .prepare(
      `SELECT COUNT(*) AS n FROM titles r
       WHERE r.target IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM titles t WHERE t.title = r.target)`
    )
    .get() as { n: number }
  check('titles: redirect targets resolve', dangling.n === 0, `${dangling.n} dangling`)
}

/**
 * Search, driven through the real bridge.
 *
 * The assertions are about *quality*, not just plumbing. A search that returns
 * rows is easy; the three properties that make it usable are that an exact
 * title wins, that aliases resolve to their article, and that the wiki's 203k
 * misspelling redirects collapse instead of flooding the palette.
 */
async function checkSearch(wc: Electron.WebContents): Promise<void> {
  const run = async (q: string): Promise<Array<{ title: string; matchedVia?: string }>> =>
    JSON.parse(
      await wc.executeJavaScript(`window.rp.search(${JSON.stringify(q)}).then(r => JSON.stringify(r))`)
    )

  const started = Date.now()
  const whip = await run('abyssal whip')
  const elapsed = Date.now() - started

  check('search: exact title ranks first', whip[0]?.title === 'Abyssal whip', whip[0]?.title ?? 'no results')
  // First call pays for building the in-memory index (~180ms); the budget is
  // generous because what matters is that it is not seconds.
  check('search: responds promptly', elapsed < 1500, `${elapsed}ms including index load`)

  // "Bowfa" is a redirect. Resolving it to the article is the whole point of
  // carrying 203k redirects around.
  const bowfa = await run('bowfa')
  check(
    'search: alias resolves to article',
    bowfa[0]?.title === 'Bow of faerdhinen' && bowfa[0]?.matchedVia?.toLowerCase() === 'bowfa',
    `${bowfa[0]?.title} via ${bowfa[0]?.matchedVia}`
  )

  // Raw matching returns >1100 rows for "aby", nearly all of them misspellings
  // of a few dozen articles. Collapsed, every row must be a distinct article.
  const aby = await run('aby')
  const unique = new Set(aby.map((r) => r.title))
  check('search: collapses duplicate aliases', unique.size === aby.length, `${aby.length} rows, ${unique.size} distinct`)

  // A typo the wiki has no redirect for — this is what error tolerance buys.
  const typo = await run('dragn scim')
  check('search: tolerates a typo', typo.length > 0, typo[0]?.title ?? 'no results')

  check('search: ignores one-character queries', (await run('a')).length === 0)
}

/**
 * The transform, against markup built to break it.
 *
 * Offline and synchronous, so these run on every smoke pass regardless of the
 * cache state. The security assertions matter most: the output is injected with
 * dangerouslySetInnerHTML, so a script tag surviving here is a real hole rather
 * than a cosmetic bug.
 */
function checkTransform(): void {
  const hostile = `
    <div class="mw-parser-output">
      <script>window.pwned = 1</script>
      <p onclick="alert(1)">Text with an <a href="/w/Abyssal_whip" title="x">internal link</a>,
         an <a href="//example.com/x">external one</a>,
         a <a href="javascript:alert(1)">nasty one</a>,
         and a <a href="/w/File:Thing.png">file link</a>.</p>
      <img src="/images/Abyssal_whip.png?727e9" srcset="/images/x.png 2x" />
      <table class="infobox"><tbody>
        <tr><th class="infobox-header">Abyssal whip</th></tr>
        <tr><td class="infobox-image"><img src="/images/Abyssal_whip.png?727e9" /></td></tr>
        <tr><th>Members</th><td>Yes</td></tr>
        <tr><th>Released</th><td><a href="/w/2005" title="2005">2005</a></td></tr>
      </tbody></table>
      <div class="navbox">nav junk</div>
      <table class="wikitable"><tbody><tr><td>cell</td></tr></tbody></table>
      <!-- parser cache noise -->
    </div>`

  const { html, infobox } = transform(hostile, 'Some page')

  check('transform: strips script tags', !/<script/i.test(html))
  check('transform: strips inline handlers', !/onclick/i.test(html))
  check('transform: strips javascript: urls', !/javascript:/i.test(html))
  check('transform: strips comments', !html.includes('parser cache noise'))
  check('transform: strips navboxes', !html.includes('nav junk'))

  check('transform: rewrites internal links', html.includes('rp://page/Abyssal%20whip'), '')
  check('transform: carries data-title', html.includes('data-title="Abyssal whip"'))
  check('transform: marks external links', /rp-external/.test(html))
  // A File: link resolves to a page this app cannot render, so the anchor goes
  // and the text stays.
  check(
    'transform: unwraps non-article namespaces',
    !html.includes('File:Thing.png') && html.includes('file link')
  )

  check('transform: rewrites images', html.includes('rpimg://img/Abyssal_whip.png'), '')
  check('transform: drops srcset', !/srcset/i.test(html))
  check('transform: tags wikitables', html.includes('rp-table'))

  check('transform: extracts infobox', infobox !== null)
  check('transform: infobox header', infobox?.header === 'Abyssal whip', infobox?.header ?? '')
  check('transform: infobox rows', infobox?.rows.length === 2, `${infobox?.rows.length} rows`)
  check(
    'transform: infobox values keep links',
    infobox?.rows[1]?.value.includes('rp://page/2005') ?? false
  )
  // Lifted, not copied: leaving it in the body would render it twice.
  check('transform: infobox removed from body', !html.includes('infobox-header'))
}

/**
 * An article end to end, through the real bridge.
 *
 * Uses whatever is already cached: a smoke check has no business making wiki
 * requests on every run. `SMOKE_FETCH=1` opts into fetching one page — a
 * handful of requests — so the full path can be exercised deliberately.
 */
async function checkArticle(wc: Electron.WebContents): Promise<void> {
  const cached = db
    .get()
    .prepare('SELECT title FROM pages ORDER BY fetched_at DESC LIMIT 1')
    .get() as { title: string } | undefined

  const title = cached?.title ?? (process.env.SMOKE_FETCH ? 'Abyssal whip' : null)
  if (!title) {
    check('article: renders', true, 'nothing cached — run with SMOKE_FETCH=1 to fetch one')
    return
  }

  const raw = await wc.executeJavaScript(
    `window.rp.getPage(${JSON.stringify(title)}).then(a => JSON.stringify(a))`
  )
  const article = JSON.parse(raw) as {
    title: string
    html: string
    cached: boolean
    infobox: { rows: unknown[] } | null
    sections: unknown[]
    categories: string[]
  } | null

  check('IPC round trip (getPage)', article?.title === title, article?.title ?? 'null')
  check(
    'article: body is transformed',
    (article?.html.length ?? 0) > 200 && !/<script/i.test(article?.html ?? ''),
    `${article?.html.length ?? 0} bytes${article?.cached ? ', from cache' : ', fetched'}`
  )
  check(
    'article: links point at rp://',
    (article?.html.includes('rp://page/') ?? false) && !/href="\/w\//.test(article?.html ?? '')
  )
  check(
    'article: images point at rpimg://',
    (article?.html.includes('rpimg://') ?? false) && !article?.html.includes('/images/')
  )
  check('article: has sections', (article?.sections.length ?? 0) > 0, `${article?.sections.length}`)
  check(
    'article: has categories',
    (article?.categories.length ?? 0) > 0,
    (article?.categories.slice(0, 3) ?? []).join(', ')
  )

  await checkImageProtocol(wc, article?.html ?? '')
}

/** The rpimg:// protocol actually serves bytes the renderer can display. */
async function checkImageProtocol(wc: Electron.WebContents, html: string): Promise<void> {
  const match = /rpimg:\/\/([^"']+)/.exec(html)
  if (!match) {
    check('rpimg: serves cached images', false, 'no rpimg url found in article html')
    return
  }

  // Loaded as a real <img> in the renderer, so this exercises the protocol
  // handler, the CSP allowance and the on-disk cache together — fetch() would
  // prove less.
  const result = await wc.executeJavaScript(`
    new Promise((resolve) => {
      const img = new Image()
      const timer = setTimeout(() => resolve('timeout'), 8000)
      img.onload = () => { clearTimeout(timer); resolve('ok:' + img.naturalWidth + 'x' + img.naturalHeight) }
      img.onerror = () => { clearTimeout(timer); resolve('error') }
      img.src = ${JSON.stringify(match[0])}
    })
  `)

  check('rpimg: serves cached images', String(result).startsWith('ok:'), `${match[0]} -> ${result}`)
}

/**
 * Staleness bookkeeping and the crawler's pause behaviour.
 *
 * Offline: the marking rule is pure SQL and the pause is pure state, so neither
 * needs the network. The `revid <` comparison is the part worth pinning down —
 * `!=` would re-mark a page the crawler had just refreshed, and the crawler
 * would then chase its own tail forever.
 */
async function checkCrawl(wc: Electron.WebContents): Promise<void> {
  const raw = await wc.executeJavaScript('window.rp.getCrawlState().then(s => JSON.stringify(s))')
  const state = JSON.parse(raw) as { phase: string; cached: number }
  check(
    'IPC round trip (getCrawlState)',
    typeof state?.cached === 'number' && typeof state.phase === 'string',
    `${state?.phase}, ${state?.cached} cached`
  )

  const d = db.get()
  const probe = '__smoke_stale_probe__'
  d.prepare(
    `INSERT INTO pages (title, revid, html, fetched_at, stale) VALUES (?, 100, '<p>x</p>', ?, 0)
     ON CONFLICT(title) DO UPDATE SET revid = 100, stale = 0`
  ).run(probe, Date.now())

  const mark = d.prepare('UPDATE pages SET stale = 1 WHERE title = ? AND revid < ?')
  const isStale = (): boolean =>
    (d.prepare('SELECT stale FROM pages WHERE title = ?').get(probe) as { stale: number }).stale === 1

  check('crawl: a newer revision marks stale', Number(mark.run(probe, 101).changes) === 1 && isStale())

  d.prepare('UPDATE pages SET stale = 0, revid = 101 WHERE title = ?').run(probe)
  // The revision we already hold must not re-mark: otherwise every refresh
  // immediately re-queues the page it just fetched.
  check(
    'crawl: the held revision does not',
    Number(mark.run(probe, 101).changes) === 0 && !isStale()
  )

  d.prepare('DELETE FROM pages WHERE title = ?').run(probe)

  // Visibility gating: the crawler must yield the request queue to whatever is
  // on screen. Toggling it here is safe because no crawl is running under SMOKE.
  sync.setWindowVisible(true)
  check('crawl: parks while the window is visible', sync.getState().phase !== 'crawling')
  sync.setWindowVisible(false)
}

/** The tool definitions are internally consistent. Offline. */
function checkToolRegistry(): void {
  const ids: ToolId[] = ['dps', 'calculators', 'profile']
  check(
    'tools: all three defined',
    ids.every((id) => TOOLS[id]?.url !== undefined),
    ids.join(', ')
  )

  // Each tool's own URL must satisfy its navigation guard, or the very first
  // load would be bounced out to the system browser.
  const mismatched = ids.filter((id) => !TOOLS[id].allowNavigation.test(TOOLS[id].url('x')))
  check('tools: urls satisfy their own nav guard', mismatched.length === 0, mismatched.join(', '))

  check(
    'tools: profile url carries the username',
    TOOLS.profile.url('Zezima').endsWith('/Zezima')
  )
  // The wiki renders light by default; without this the pane is a white slab.
  check(
    'tools: wiki calculators force dark',
    TOOLS.calculators.cookies?.some((c) => c.name === 'theme' && c.value === 'dark') ?? false
  )
}

/**
 * Load a tool for real and confirm the chrome-hiding CSS matched something.
 *
 * Gated behind SMOKE_FETCH because it hits three third-party sites. It is also
 * the check most likely to fail one day for reasons outside this repo — these
 * are other people's pages and they get redeployed — which is exactly why the
 * selectors are asserted rather than assumed.
 */
async function checkToolPane(win: Electron.BrowserWindow): Promise<void> {
  pane.attach(win)
  pane.setBounds({ x: 60, y: 50, width: 900, height: 600 })

  const probe = async (
    id: ToolId,
    arg: string | undefined,
    expression: string
  ): Promise<unknown> => {
    await pane.show(id, arg)
    const wc = pane.debugWebContents()
    if (!wc) return 'no pane'
    // insertCSS runs on did-finish-load; give the injection a beat to land.
    await settle(600)
    return wc.executeJavaScript(expression)
  }

  const dpsHidden = await probe(
    'dps',
    undefined,
    `(() => {
       const h = document.querySelector('main > div:first-child:has(h1)')
       return h ? getComputedStyle(h).display : 'no-match'
     })()`
  )
  check('tools: dps header hidden', dpsHidden === 'none', String(dpsHidden))

  const calcDark = await probe(
    'calculators',
    'Calculator:Smithing',
    `(() => {
       const nav = document.querySelector('#mw-navigation')
       return JSON.stringify({
         dark: document.body.className.includes('wgl-theme-dark'),
         navHidden: nav ? getComputedStyle(nav).display === 'none' : 'no-match',
       })
     })()`
  )
  const calc = JSON.parse(String(calcDark)) as { dark: boolean; navHidden: boolean | string }
  check('tools: wiki calculator renders dark', calc.dark === true, `dark=${calc.dark}`)
  check('tools: wiki skin chrome hidden', calc.navHidden === true, `navHidden=${calc.navHidden}`)

  pane.hide()
}

/**
 * Grand Exchange prices, end to end.
 *
 * Behind SMOKE_FETCH because it pulls the 862 KB mapping and the full latest
 * table. What it is really checking is arithmetic and shape: a margin that is
 * buy-minus-sell, a series that is ordered and non-empty, and the fact that
 * `/latest` covers every item so one request serves the whole app.
 */
async function checkPrices(wc: Electron.WebContents): Promise<void> {
  // 4151 is the Abyssal whip: always tradeable, always liquid.
  const raw = await wc.executeJavaScript('window.rp.geDetail(4151).then(d => JSON.stringify(d))')
  const d = JSON.parse(raw) as {
    item: { name: string; buyLimit: number | null }
    price: { high: number | null; low: number | null } | null
    margin: number | null
    series: Array<{ ts: number; avgHigh: number | null }>
  } | null

  check('IPC round trip (geDetail)', d?.item?.name === 'Abyssal whip', d?.item?.name ?? 'null')
  check(
    'ge: has live prices',
    (d?.price?.high ?? 0) > 0 && (d?.price?.low ?? 0) > 0,
    `buy ${d?.price?.high} / sell ${d?.price?.low}`
  )
  check(
    'ge: margin is buy minus sell',
    d?.margin === (d?.price?.high ?? 0) - (d?.price?.low ?? 0),
    String(d?.margin)
  )
  check('ge: has price history', (d?.series.length ?? 0) > 50, `${d?.series.length} points`)

  const ordered = (d?.series ?? []).every((p, i, a) => i === 0 || p.ts > a[i - 1].ts)
  check('ge: series is ordered by time', ordered)

  // One /latest request populates every item, which is the whole reason it is
  // fetched wholesale rather than per item.
  const priced = db.get().prepare('SELECT COUNT(*) AS n FROM prices').get() as { n: number }
  check('ge: latest covers the whole table', priced.n > 3000, `${priced.n} items priced`)

  const named = await wc.executeJavaScript(
    `window.rp.geFindByName('Twisted bow').then(i => i && i.id)`
  )
  check('ge: name lookup resolves', named === 20997, String(named))
}

/**
 * The article never scrolls sideways.
 *
 * Worth a permanent check rather than an eyeball. The wiki ships content that
 * has no intrinsic width limit — the Chart.js config blocks were a single
 * 626,588px line — and a page-wide horizontal scrollbar is both the ugliest
 * possible failure and the easiest to reintroduce with one CSS change.
 *
 * Runs only when an article is on screen, which the screenshot pass arranges.
 */
async function checkNoHorizontalOverflow(wc: Electron.WebContents): Promise<void> {
  const raw = await wc.executeJavaScript(`
    (() => {
      const scroll = document.querySelector('.article-scroll')
      if (!scroll) return JSON.stringify({ skipped: true })
      const over = scroll.scrollWidth - scroll.clientWidth
      let worst = null
      if (over > 2) {
        for (const el of scroll.querySelectorAll('*')) {
          if (el.scrollWidth > scroll.clientWidth + 2 &&
              (!worst || el.scrollWidth > worst.w)) {
            worst = { w: el.scrollWidth, sel: el.tagName + '.' + (el.className || '').toString().slice(0, 40) }
          }
        }
      }
      return JSON.stringify({ over, worst })
    })()
  `)
  const result = JSON.parse(raw) as { skipped?: boolean; over?: number; worst?: { w: number; sel: string } | null }
  if (result.skipped) return
  check(
    'article: no horizontal overflow',
    (result.over ?? 0) <= 2,
    result.worst ? `${result.worst.sel} is ${result.worst.w}px` : 'clean'
  )
}

/**
 * The core interaction: hotkey opens, Escape closes, nothing in between.
 *
 * The hide leg is driven from the renderer through `window.rp.hide()` rather
 * than by calling `hide()` here, because the renderer's Escape handler is the
 * path that actually ships.
 */
async function checkShowHide(win: Electron.BrowserWindow): Promise<void> {
  // Install the listener and park its promise on `window`, awaiting only the
  // installation. Awaiting the listener promise itself would deadlock, and
  // firing show() without awaiting anything races the subscription — the event
  // arrives before onShown is wired and the check fails for no real reason.
  await win.webContents.executeJavaScript(`
    window.__shown = new Promise((r) => {
      const timer = setTimeout(() => r(false), 3000)
      const off = window.rp.onShown(() => { clearTimeout(timer); off(); r(true) })
    }); true
  `)

  show()
  check('show() makes the window visible', win.isVisible())
  check('shown window is pinned on top', win.isAlwaysOnTop())
  check(
    'renderer received the shown event',
    (await win.webContents.executeJavaScript('window.__shown')) === true
  )

  await win.webContents.executeJavaScript('window.rp.hide()')
  await settle()
  check('renderer can close the window', !win.isVisible())
  check('hidden window drops always-on-top', !win.isAlwaysOnTop())

  // Restore a visible window so SMOKE_SHOT captures something.
  show()
  await settle()
}

/**
 * Write PNGs of the real UI to out/ for eyeballing the design.
 *
 * Driven entirely through the renderer's own store — no synthetic keystrokes.
 * Global input automation types into whatever happens to be focused, which is
 * emphatically not always this window.
 */
async function screenshot(win: Electron.BrowserWindow): Promise<void> {
  const shoot = async (name: string): Promise<boolean> => {
    const image = await win.webContents.capturePage()
    // Not app.getAppPath(): running the built entry directly makes that
    // out/main, which would nest the file one level too deep.
    writeFileSync(join(process.cwd(), 'out', name), image.toPNG())
    return image.getSize().width > 0
  }

  const search = await shoot('smoke-search.png')

  // The Grand Exchange view, so the chart gets an eye on it too.
  await win.webContents.executeJavaScript(
    `window.__rpNav.getState().push({ kind: 'ge', itemId: 4151 }); true`
  )
  await waitFor(win.webContents, '.chart-svg', 12000)
  await settle(800)
  await shoot('smoke-ge.png')
  await win.webContents.executeJavaScript(`window.__rpNav.getState().reset(); true`)
  await settle(300)

  // Both themes, so a light-mode regression shows up without a manual pass.
  if (process.env.SMOKE_THEMES) {
    for (const theme of ['light', 'dark'] as const) {
      await win.webContents.executeJavaScript(
        `window.rp.setSettings({ theme: '${theme}' }); true`
      )
      await settle(500)
      await shoot(`smoke-search-${theme}.png`)
    }
  }

  // Navigate by pushing onto the history stack the UI already uses, then wait
  // for the article body to actually exist rather than guessing at a delay.
  const cached = db
    .get()
    .prepare('SELECT title FROM pages ORDER BY fetched_at DESC LIMIT 1')
    .get() as { title: string } | undefined

  let article = true
  if (cached) {
    await win.webContents.executeJavaScript(`
      window.__rpNav.getState().push({ kind: 'page', title: ${JSON.stringify(cached.title)} }); true
    `)
    await waitFor(win.webContents, '.article-body', 8000)
    // Images resolve through the protocol handler; give them a moment to paint.
    await settle(1200)
    article = await shoot('smoke-article.png')
    await checkNoHorizontalOverflow(win.webContents)
  }

  check(
    'screenshots written',
    search && article,
    cached ? 'out/smoke-search.png, out/smoke-article.png' : 'out/smoke-search.png (no page cached)'
  )
}

/** Poll for a selector to appear, so captures are not timing guesses. */
async function waitFor(wc: Electron.WebContents, selector: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const found = await wc.executeJavaScript(
      `!!document.querySelector(${JSON.stringify(selector)})`
    )
    if (found) return
    await settle(150)
  }
}

function waitForLoad(wc: Electron.WebContents): Promise<void> {
  if (!wc.isLoading()) return Promise.resolve()
  return new Promise((resolve) => wc.once('did-finish-load', () => resolve()))
}

/** Let the compositor catch up with a show/hide before reading window state. */
function settle(ms = 250): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * Print the results and exit.
 *
 * Written with `writeSync` rather than `console.log`: `app.exit` tears the
 * process down without draining Node's async stdout queue, so a buffered report
 * is simply lost — which looks exactly like the smoke run never happening. The
 * same text also goes to out/smoke.log, because Electron on Windows is a GUI
 * subsystem binary and does not always reach an attached console.
 */
function report(): void {
  const pad = Math.max(...checks.map((c) => c.name.length))
  const failed = checks.filter((c) => !c.pass).length
  const lines = [
    '',
    '══════════════════════════════════════════════════════',
    '  SMOKE  ·  rune-panel',
    '══════════════════════════════════════════════════════',
    ...checks.map((c) => `  ${c.pass ? 'ok  ' : 'FAIL'}  ${c.name.padEnd(pad)}  ${c.detail}`),
    '──────────────────────────────────────────────────────',
    failed === 0 ? `  ALL ${checks.length} CHECKS PASSED` : `  ${failed} of ${checks.length} FAILED`,
    '══════════════════════════════════════════════════════',
    '',
  ]
  const text = lines.join('\n') + '\n'

  try {
    writeSync(1, text)
  } catch {
    /* no stdout to write to; the log file below is the fallback */
  }
  try {
    writeFileSync(join(process.cwd(), 'out', 'smoke.log'), text)
  } catch {
    /* out/ missing means the build did not run; the exit code still reports */
  }

  hide()
  app.exit(failed === 0 ? 0 : 1)
}
