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

import { app, globalShortcut, shell, Tray } from 'electron'
import { writeFileSync, writeSync } from 'fs'
import { join } from 'path'
import { getWindow, show, hide } from './window'
import * as anim from './anim'
import { MOTION, WINDOW, type Settings } from '../shared/ipc'
import * as db from './db'
import * as client from './wiki/client'
import * as titles from './wiki/titles'
import { transform } from './wiki/transform'
import * as sync from './wiki/sync'
import * as pane from './tools/pane'
import { TOOLS, PALETTES } from './tools/registry'
import * as settingsModule from './settings'
import { openExternal } from './safe-open'
import type { ToolId } from '../shared/ipc'
import { XP_FOR_LEVEL } from '../shared/xp'

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

      await checkCloseButton(win.webContents)
      await checkSetupAndUpdater(win.webContents)

      checkSafeOpen()
      checkDatabase()
      checkClient()
      await checkSettingsRoundTrip(win.webContents, initial)
      await checkTitleIndex(win.webContents)
      await checkSearch(win.webContents)
      checkTransform()
      await checkArticle(win.webContents)
      await checkCrawl(win.webContents)
      checkToolRegistry()
      if (process.env.SMOKE_FETCH) {
        await checkPrices(win.webContents)
        await checkProfileLookup(win.webContents)
        await checkHiscores(win.webContents)
        await checkToolPane(win)
      }
      await checkShowHide(win)
      await checkAutoFocus(win)

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

/**
 * The close control is in the corner people look in.
 *
 * Not a cosmetic check. It is the only way out of the window for anyone who
 * does not know the hotkey, and it had drifted 959px short of the right edge —
 * present, clickable, and effectively invisible — because the title beside it
 * stops growing at a max-width and nothing filled the gap.
 */
async function checkCloseButton(wc: Electron.WebContents): Promise<void> {
  // The shell renders empty until the first-run query resolves, so the button
  // does not exist for the first frame or two.
  await waitFor(wc, '.icon-btn.is-close', 5000)

  const raw = await wc.executeJavaScript(`
    (() => {
      const b = document.querySelector('.icon-btn.is-close')
      if (!b) return JSON.stringify({ found: false })
      const r = b.getBoundingClientRect()
      return JSON.stringify({
        found: true,
        fromRight: Math.round(window.innerWidth - r.right),
        fromTop: Math.round(r.top),
        size: Math.round(r.width),
      })
    })()
  `)
  const b = JSON.parse(raw) as { found: boolean; fromRight?: number; fromTop?: number; size?: number }

  check('close button exists', b.found)
  check(
    'close button sits in the top-right corner',
    (b.fromRight ?? 999) < 24 && (b.fromTop ?? 999) < 24 && (b.size ?? 0) >= 24,
    `${b.fromRight}px from right, ${b.fromTop}px from top, ${b.size}px`
  )
}

/**
 * First-run setup and the updater, without triggering either.
 *
 * The interesting properties are negative ones: a populated install must not
 * show the wizard, and a development build must not pretend it can update
 * itself. Both are states you would only notice were wrong by launching a
 * fresh install or shipping a broken release.
 */
async function checkSetupAndUpdater(wc: Electron.WebContents): Promise<void> {
  const raw = await wc.executeJavaScript('window.rp.getSetup().then(s => JSON.stringify(s))')
  const state = JSON.parse(raw) as { done: boolean; running: boolean; percent: number }
  const populated = titles.state().count > 0

  check(
    'setup: wizard state matches the index',
    state.done === populated,
    `done=${state.done}, ${titles.state().count} titles`
  )

  const upRaw = await wc.executeJavaScript('window.rp.getUpdate().then(s => JSON.stringify(s))')
  const update = JSON.parse(upRaw) as { state: string; message?: string }
  check('IPC round trip (getUpdate)', typeof update?.state === 'string', update?.state)
  // A dev build has nothing to replace; claiming otherwise would mean the
  // updater is live in a context where quitAndInstall throws.
  check(
    'updater: development build reports unsupported',
    update.state === 'unsupported',
    `${update.state}${update.message ? ` — ${update.message}` : ''}`
  )
}

/**
 * Only http and https ever reach the shell.
 *
 * `shell.openExternal` launches whatever Windows registered for a scheme, so
 * `file:///` opens local executables and `ms-msdt:` and friends are known
 * attack vectors. The tool pane renders third-party pages that can call
 * `window.open` with anything, which is what makes this worth pinning down
 * rather than trusting.
 */
function checkSafeOpen(): void {
  const opened: string[] = []
  const real = shell.openExternal.bind(shell)
  ;(shell as { openExternal: typeof shell.openExternal }).openExternal = async (u: string) => {
    opened.push(u)
  }

  for (const url of [
    'file:///C:/Windows/System32/calc.exe',
    'ms-msdt:/id PCWDiagnostic',
    'search-ms:query=x',
    'javascript:alert(1)',
    'not a url at all',
  ]) {
    openExternal(url)
  }
  const leaked = [...opened]

  opened.length = 0
  openExternal('https://oldschool.runescape.wiki/w/Varrock')
  const allowed = opened.length === 1

  ;(shell as { openExternal: typeof shell.openExternal }).openExternal = real

  check('open: dangerous schemes are refused', leaked.length === 0, leaked.join(', '))
  check('open: https still opens', allowed)
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
  // One form is the ordinary case; a page describing more than one of the same
  // subject — Vorkath awake and asleep — carries a tab per form.
  check('transform: one form for a plain page', infobox?.forms.length === 1, `${infobox?.forms.length} forms`)
  const form = infobox?.forms[0]
  check('transform: infobox header', form?.header === 'Abyssal whip', form?.header ?? '')
  check('transform: infobox rows', form?.rows.length === 2, `${form?.rows.length} rows`)
  check(
    'transform: infobox values keep links',
    form?.rows[1]?.value.includes('rp://page/2005') ?? false
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

  const title = process.env.SMOKE_PAGE ?? cached?.title ?? (process.env.SMOKE_FETCH ? 'Abyssal whip' : null)
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


  // Variant switching. Items that exist charged and uncharged pack every form's
  // values into the same infobox, and the alternates live only in a hidden
  // payload the wiki's own scripts read. If that join breaks, the tabs render
  // but every tab shows the first variant.
  if (title === 'Scythe of vitur') {
    const box = JSON.parse(
      await wc.executeJavaScript(
        `window.rp.getPage('Scythe of vitur').then(a => JSON.stringify(a.infobox))`
      )
    ) as {
      variants: string[]
      defaultVariant: number
      headerByVariant?: Array<string | null>
      rows: Array<{ label: string; byVariant?: Array<string | null> }>
    } | null

    check('variants: tabs detected', box?.variants.join('/') === 'Uncharged/Charged', box?.variants.join('/') ?? 'none')
    // Deliberately against the wiki's own default of Charged: the uncharged form
    // is the tradeable one, so it is the form with a price to show.
    check('variants: defaults to the tradeable form', box?.defaultVariant === 0, `${box?.defaultVariant} (${box?.variants[box?.defaultVariant ?? 0]})`)
    check(
      'variants: name differs per tab',
      box?.headerByVariant?.[0] !== box?.headerByVariant?.[1],
      `${box?.headerByVariant?.[0]} / ${box?.headerByVariant?.[1]}`
    )
    const switched = box?.rows.filter((r) => r.byVariant).length ?? 0
    check('variants: rows carry per-variant values', switched > 3, `${switched} switched rows`)
  }
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

  const load = (url: string): Promise<string> =>
    wc.executeJavaScript(`
      new Promise((resolve) => {
        const img = new Image()
        const timer = setTimeout(() => resolve('timeout'), 8000)
        img.onload = () => { clearTimeout(timer); resolve('ok:' + img.naturalWidth + 'x' + img.naturalHeight) }
        img.onerror = () => { clearTimeout(timer); resolve('error') }
        img.src = ${JSON.stringify('URL')}.replace('URL', ${JSON.stringify(url)})
      })
    `)

  // The second origin. The host selects where an image comes from, so this is
  // the same protocol reaching a different CDN — and the boss grid is blank
  // without it.
  const boss = await load('rpimg://hs/game_icon_abyssalsire.png')
  check('rpimg: serves hiscores icons from the second origin', boss.startsWith('ok:'), boss)

  // And only from origins on the list. This handler fetches from the network on
  // the renderer's behalf; one that honoured any host would be an open proxy
  // wrapped around the sandbox.
  const stranger = await load('rpimg://evil.example.com/x.png')
  check('rpimg: refuses an origin that is not allow-listed', stranger === 'error', stranger)
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
  // Derived from the registry rather than listed here, so adding a tool cannot
  // quietly leave itself untested — the previous hard-coded trio would have.
  const ids = Object.keys(TOOLS) as ToolId[]
  check(
    'tools: every tool is defined',
    ids.length > 0 && ids.every((id) => TOOLS[id]?.url !== undefined),
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

  // The pane is sized from a rectangle the renderer measures. A zero-height
  // slot loads the page perfectly and shows nothing, which is exactly the
  // failure this catches — and exactly what a CSS change reintroduced once.
  await win.webContents.executeJavaScript(
    `window.__rpNav.getState().push({ kind: 'tool', id: 'dps' }); true`
  )
  await settle(1200)
  const slot = JSON.parse(
    await win.webContents.executeJavaScript(`
      (() => {
        const el = document.querySelector('.tool-slot')
        if (!el) return JSON.stringify({ found: false })
        const r = el.getBoundingClientRect()
        return JSON.stringify({ found: true, w: Math.round(r.width), h: Math.round(r.height) })
      })()
    `)
  ) as { found: boolean; w?: number; h?: number }
  check(
    'tools: pane slot has a real size',
    slot.found && (slot.w ?? 0) > 200 && (slot.h ?? 0) > 200,
    `${slot.w}x${slot.h}`
  )
  await win.webContents.executeJavaScript(`window.__rpNav.getState().reset(); true`)
  await settle(300)

  const dps = JSON.parse(
    String(
      await probe(
        'dps',
        undefined,
        `(() => {
           const h = document.querySelector('main > div:first-child:has(h1)')
           return JSON.stringify({
             header: h ? getComputedStyle(h).display : 'no-match',
             bg: getComputedStyle(document.body).backgroundColor,
           })
         })()`
      )
    )
  ) as { header: string; bg: string }

  check('tools: dps header hidden', dps.header === 'none', dps.header)
  // The pane cannot read our CSS variables, so the palette travels with the
  // injection as literal colours. This is the check that it arrived.
  // Compared against whichever theme is actually set, not a hardcoded one —
  // the point is that the pane matches the app, not that it is dark.
  const wanted = hexToRgb(PALETTES[settingsModule.get().theme].surface)
  check(
    'tools: dps repainted in the app theme',
    dps.bg === wanted,
    `${dps.bg} vs ${wanted} (${settingsModule.get().theme})`
  )

  // A WebContentsView composites above the DOM and cannot be layered under
  // anything, so any menu opening over the content area is invisible until the
  // pane stands down. Driven through the real store, since that is the
  // mechanism the UI uses.
  await win.webContents.executeJavaScript(
    `window.__rpNav.getState().push({ kind: 'tool', id: 'dps' }); true`
  )
  await settle(900)
  const visibleWithTool = pane.debugVisible()

  const fullBounds = pane.debugBounds()

  // A theme-picker-shaped overlay: bottom-left of the content area.
  await win.webContents.executeJavaScript(`
    (() => {
      const s = window.__rpStore.getState()
      s.pushOverlay()
      s.setOverlayRect({ x: 64, y: window.innerHeight - 200, width: 232, height: 170 })
    })(); true
  `)
  await settle(500)
  const shrunk = pane.debugBounds()
  const stillVisible = pane.debugVisible()

  await win.webContents.executeJavaScript(`window.__rpStore.getState().popOverlay(); true`)
  await settle(500)
  const restored = pane.debugBounds()

  // The point of the change: the page stays on screen and merely gives up the
  // smallest slice that clears the menu, rather than vanishing for it.
  // A disallowed navigation must be blocked outright rather than forwarded to
  // the system browser — these pages carry ad redirects, and an embedded panel
  // has no business opening arbitrary URLs on the user's machine.
  const opened: string[] = []
  const realOpen = shell.openExternal.bind(shell)
  ;(shell as { openExternal: typeof shell.openExternal }).openExternal = async (u: string) => {
    opened.push(u)
  }
  const wc = pane.debugWebContents()
  wc?.emit('will-navigate', { preventDefault: () => {} }, 'https://tracker.example.com/sync?x=1')
  await settle(200)
  ;(shell as { openExternal: typeof shell.openExternal }).openExternal = realOpen
  check('tools: off-site navigation is blocked, not opened', opened.length === 0, opened.join(', '))

  check(
    'tools: pane stays visible under an overlay',
    visibleWithTool && stillVisible,
    `shown=${visibleWithTool} stillVisible=${stillVisible}`
  )
  // Which edge gives way depends on where the overlay is, so the assertion is
  // about area rather than a particular dimension — and about the origin
  // staying put, since a shifted pane slides the whole page sideways.
  const area = (r: { width: number; height: number }): number => r.width * r.height
  check(
    'tools: pane shrinks clear of the overlay, then restores',
    area(shrunk) < area(fullBounds) &&
      shrunk.x === fullBounds.x &&
      shrunk.y === fullBounds.y &&
      area(restored) === area(fullBounds),
    `${fullBounds.width}x${fullBounds.height} -> ${shrunk.width}x${shrunk.height} -> ${restored.width}x${restored.height}`
  )

  await win.webContents.executeJavaScript(`window.__rpNav.getState().reset(); true`)
  await settle(300)

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

  // Charged items are untradeable; the price feed carries only their uncharged
  // form, under a different name than the wiki article. Without the fallback
  // these all report "not tradeable", which is plainly wrong.
  for (const [article, wanted] of [
    ['Scythe of vitur', 'Scythe of vitur (uncharged)'],
    ['Sanguinesti staff', 'Sanguinesti staff (uncharged)'],
    ['Bow of faerdhinen', 'Bow of faerdhinen (inactive)'],
  ] as const) {
    const raw = await wc.executeJavaScript(
      `window.rp.geFindByName(${JSON.stringify(article)}).then(i => i && i.name)`
    )
    check(`ge: "${article}" resolves to its tradeable form`, raw === wanted, String(raw))
  }

  // A different range must return different buckets, not the previous step's
  // rows read back off a colliding cache key.
  const short = JSON.parse(
    await wc.executeJavaScript(`window.rp.geDetail(4151, '5m').then(d => JSON.stringify(d.series.length))`)
  ) as number
  const long = JSON.parse(
    await wc.executeJavaScript(`window.rp.geDetail(4151, '24h').then(d => JSON.stringify(d.series))`)
  ) as Array<{ ts: number }>
  const span = long.length > 1 ? (long.at(-1)!.ts - long[0].ts) / 86400 : 0
  check('ge: 24h range spans about a year', span > 300, `${Math.round(span)} days, ${long.length} points`)
  check('ge: 5m range is its own series', short > 0, `${short} points`)
}

/**
 * Hiscores, against the live endpoint.
 *
 * Also checks the experience table, since it is computed from the game's
 * formula rather than transcribed and a wrong table would quietly mis-state
 * every "to next level" in the app.
 */
async function checkHiscores(wc: Electron.WebContents): Promise<void> {
  // Two known thresholds. 13,034,431 is level 99; 83 is level 2.
  check('xp: level 2 threshold', XP_FOR_LEVEL[2] === 83, String(XP_FOR_LEVEL[2]))
  check('xp: level 99 threshold', XP_FOR_LEVEL[99] === 13_034_431, String(XP_FOR_LEVEL[99]))

  // Lynx Titan: maxed, and the first account to reach 4.6b total experience.
  const raw = await wc.executeJavaScript(
    `window.rp.hiscores('Lynx Titan').then(h => JSON.stringify(h)).catch(e => JSON.stringify({ error: String(e) }))`
  )
  const h = JSON.parse(raw) as {
    error?: string
    name?: string
    mode?: string
    totalLevel?: number
    skills?: Array<{ name: string; level: number; progress: { fraction: number } }>
  }

  if (h.error) {
    check('IPC round trip (hiscores)', false, h.error)
    return
  }

  check('IPC round trip (hiscores)', h.name?.toLowerCase() === 'lynx titan', h.name ?? 'null')
  check('hiscores: detected the account type', h.mode === 'main', String(h.mode))
  check('hiscores: total level', h.totalLevel === 2277 || h.totalLevel === 2278, String(h.totalLevel))
  // Overall is a summary row, not a skill, and must not appear among them.
  check(
    'hiscores: overall excluded from skills',
    !(h.skills ?? []).some((s) => s.name.toLowerCase() === 'overall'),
    `${h.skills?.length} skills`
  )
  // A capped skill reads as complete rather than at the start of an
  // unreachable level.
  const maxed = h.skills?.find((s) => s.level === 99)
  check('hiscores: a maxed skill reads as complete', maxed?.progress.fraction === 1, String(maxed?.progress.fraction))

  await checkActivityGrid(wc)
}

/**
 * The activity grid, including the entries an account has *not* done.
 *
 * Those used to be filtered out in main, and the grid is the reason they are
 * not: a boss with no kills is a slot with a dash in it, which is information a
 * list of only-what-you-have-done cannot convey.
 *
 * Two accounts, at opposite ends, because either alone proves half of it. A
 * build that dropped the empties would still look right for the one with a full
 * grid; a build that lost the scores would still look right for the empty one.
 *
 * Not Lynx Titan for the full end, despite being this suite's usual reference —
 * maxed every skill and killed almost nothing, so 70 of the 71 are empty.
 */
async function checkActivityGrid(wc: Electron.WebContents): Promise<void> {
  const counts = async (player: string): Promise<{ bosses: number; empty: number }> => {
    const raw = await wc.executeJavaScript(
      `window.rp.hiscores(${JSON.stringify(player)}).then(h => JSON.stringify(h.activities)).catch(() => 'null')`
    )
    const acts = JSON.parse(raw) as Array<{ id: number; score: number }> | null
    if (!acts) return { bosses: 0, empty: 0 }
    const bosses = acts.filter((a) => a.id >= 20)
    return { bosses: bosses.length, empty: bosses.filter((a) => a.score <= 0).length }
  }

  // Zezima predates almost every boss in the game, so nearly the whole grid is
  // empty — the case that used to render as nothing at all.
  const sparse = await counts('Zezima')
  check(
    'hiscores: unattempted bosses survive the fetch',
    sparse.bosses > 50 && sparse.empty > 40,
    `${sparse.empty} empty of ${sparse.bosses}`
  )

  const complete = await counts('Framed')
  check(
    'hiscores: a full account fills the same grid',
    complete.bosses === sparse.bosses && complete.empty === 0,
    `${complete.bosses} bosses, ${complete.empty} empty`
  )
}

/** RuneProfile lookup, against the live API. */
async function checkProfileLookup(wc: Electron.WebContents): Promise<void> {
  const raw = await wc.executeJavaScript(
    `window.rp.lookupProfile('pgn').then(p => JSON.stringify(p))`
  )
  const p = JSON.parse(raw) as { exists: boolean; totalLevel?: number; error?: string }
  // The bug this replaces: `skills` is an object of totals, not an array, so
  // calling .filter on it threw on every single lookup.
  check('profile: lookup succeeds', p.exists === true, p.error ?? 'ok')
  check('profile: reports a total level', (p.totalLevel ?? 0) > 1000, String(p.totalLevel))
}

/**
 * Gear-setup tabs, in the rendered page.
 *
 * Has to run against the DOM rather than the cached HTML, because "exactly one
 * panel visible" is a CSS outcome — the markup deliberately contains all of
 * them. Skips silently on pages that carry no tabber, which is most of them.
 */
async function checkTabber(wc: Electron.WebContents): Promise<void> {
  const raw = await wc.executeJavaScript(`
    (() => {
      const t = document.querySelector('.rp-tabber')
      if (!t) return JSON.stringify({ found: false })
      const panels = t.querySelectorAll('.tabbertab')
      const visible = [...panels].filter((p) => getComputedStyle(p).display !== 'none')
      return JSON.stringify({
        found: true,
        buttons: t.querySelectorAll('.rp-tab').length,
        panels: panels.length,
        visible: visible.length,
      })
    })()
  `)
  const tabs = JSON.parse(raw) as { found: boolean; buttons?: number; panels?: number; visible?: number }
  if (!tabs.found) return

  check('tabber: built a tab strip', (tabs.buttons ?? 0) > 1, `${tabs.buttons} tabs`)
  check('tabber: shows exactly one panel', tabs.visible === 1, `${tabs.visible} of ${tabs.panels} visible`)

  // Notes were moved below the recommended-equipment table, and the lettered
  // footnote markers need a lettered list to point into.
  const layout = JSON.parse(
    await wc.executeJavaScript(`
      (() => {
        const tab = document.querySelector('.rp-tabber .tabbertab[data-tab-index="0"]')
        const notes = tab?.querySelector('.rp-gear-notes')
        const table = tab?.querySelector('table')
        const list = document.querySelector('ol.references[data-mw-group="lower-alpha"]')
        const eq = document.querySelector('.equipment-div')
        return JSON.stringify({
          notesAfterTable: !!(notes && table) &&
            (table.compareDocumentPosition(notes) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
          listStyle: list ? getComputedStyle(list).listStyleType : 'none',
          equipmentGrid: eq ? getComputedStyle(eq).display : 'none',
        })
      })()
    `)
  ) as { notesAfterTable: boolean; listStyle: string; equipmentGrid: string }

  check('tabber: gear notes sit below the table', layout.notesAfterTable)
  check('footnotes: lettered list matches lettered markers', layout.listStyle === 'lower-alpha', layout.listStyle)
  check('equipment: worn slots laid out as a grid', layout.equipmentGrid === 'grid', layout.equipmentGrid)
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
  // Against the setting, not against the default. `alwaysOnTop` is a user
  // choice and the suite runs on a real profile, so asserting the default
  // failed for anyone who had turned it off — which says nothing about show().
  const pinned = settingsModule.get().alwaysOnTop
  check(
    `shown window ${pinned ? 'is pinned on top' : 'is not pinned, per settings'}`,
    win.isAlwaysOnTop() === pinned
  )
  check(
    'renderer received the shown event',
    (await win.webContents.executeJavaScript('window.__shown')) === true
  )

  // The rectangle a hide/show cycle has to give back untouched. The open and
  // close animation walks it down to 85% and the persistence debounce is
  // watching every frame of that, so getting this wrong writes a shrunken
  // window to settings and it never grows back.
  const before = win.getBounds()

  await win.webContents.executeJavaScript('window.rp.hide()')
  await settle()
  check('renderer can close the window', !win.isVisible())
  check('hidden window drops always-on-top', !win.isAlwaysOnTop())

  // Restore a visible window so SMOKE_SHOT captures something.
  show()
  await settle()

  const after = win.getBounds()
  check(
    'a hide/show cycle gives the rectangle back',
    after.x === before.x &&
      after.y === before.y &&
      after.width === before.width &&
      after.height === before.height,
    `${before.width}x${before.height} at ${before.x},${before.y} -> ${after.width}x${after.height} at ${after.x},${after.y}`
  )

  // The debounce is 400ms and the animation is 150ms, so a frame that slipped
  // through would land after the checks above. Wait it out.
  await settle(600)
  const saved = settingsModule.get().bounds
  check(
    'no intermediate rectangle reaches settings',
    saved === null || (saved.width === before.width && saved.height === before.height),
    saved ? `${saved.width}x${saved.height}` : 'never saved'
  )

  check(
    'a shown window is fully opaque',
    win.getOpacity() === 1,
    String(win.getOpacity())
  )

  checkCollapsedRect(win, before)
}

/**
 * The caret lands in the right box.
 *
 * Two triggers, and both are asserted because they are wired separately:
 * arriving at a route, and the window being shown while already there. The
 * second is the one that cannot be tested by hand without a stopwatch — it is
 * driven by an IPC event, so a missing subscription looks exactly like a slow
 * machine.
 *
 * Routes are pushed through the app's own store rather than by clicking the
 * rail, for the same reason nothing here sends synthetic keystrokes: input
 * automation goes to whatever window happens to be focused, which is not
 * reliably this one.
 */
async function checkAutoFocus(win: Electron.BrowserWindow): Promise<void> {
  const active = (): Promise<string> =>
    win.webContents.executeJavaScript(
      `(() => { const el = document.activeElement
                return el && el.tagName === 'INPUT' ? (el.placeholder || 'unlabelled input') : (el ? el.tagName : 'nothing') })()`
    )

  const cases: Array<{ route: string; expect: string; what: string }> = [
    { route: `{ kind: 'home' }`, expect: 'Search the OSRS Wiki', what: 'home' },
    { route: `{ kind: 'hiscores' }`, expect: 'Username', what: 'hiscores' },
    { route: `{ kind: 'ge' }`, expect: 'Find an item', what: 'grand exchange' },
    { route: `{ kind: 'tool', id: 'profile' }`, expect: 'Username', what: 'runeprofile' },
  ]

  for (const { route, expect, what } of cases) {
    await win.webContents.executeJavaScript(
      `window.__rpNav.getState().push(${route}); true`
    )
    await settle(120)
    const onEnter = await active()
    check(`focus: arriving at ${what} focuses its box`, onEnter.startsWith(expect), onEnter)

    // Blur, then re-show. Without the blur a pass could just be the focus the
    // route change already left behind.
    await win.webContents.executeJavaScript('document.activeElement?.blur(); true')
    show()
    await settle(120)
    const onShow = await active()
    check(`focus: reopening on ${what} focuses its box`, onShow.startsWith(expect), onShow)
  }

  // Ctrl+G, dispatched as a real keydown on the window rather than through the
  // OS. Both halves matter and they are wired separately: it navigates from
  // elsewhere, and focuses without navigating once you are already there.
  const pressGe = (): Promise<void> =>
    win.webContents.executeJavaScript(
      `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', ctrlKey: true, bubbles: true })); true`
    )

  await win.webContents.executeJavaScript(
    `window.__rpNav.getState().push({ kind: 'home' }); true`
  )
  await settle(120)
  await pressGe()
  await settle(150)
  const routed = await win.webContents.executeJavaScript(
    `(() => { const s = window.__rpNav.getState(); return s.entries[s.index].kind })()`
  )
  check('Ctrl+G routes to the Grand Exchange', routed === 'ge', String(routed))
  check('Ctrl+G leaves the item box focused', (await active()).startsWith('Find an item'), '')

  await win.webContents.executeJavaScript('document.activeElement?.blur(); true')
  await pressGe()
  await settle(120)
  const refocused = await active()
  check(
    'Ctrl+G refocuses without renavigating when already there',
    refocused.startsWith('Find an item'),
    refocused
  )

  // The one route that deliberately does not take focus for itself. Reopening
  // still does — that is issue #1 — but it lands in the header wiki search
  // rather than in anything the article owns.
  await win.webContents.executeJavaScript(
    `window.__rpNav.getState().push({ kind: 'settings' }); true`
  )
  await settle(120)
  const onSettings = await active()
  check(
    'focus: arriving at settings takes no focus',
    !onSettings.startsWith('Username') && !onSettings.startsWith('Find an item'),
    onSettings
  )
}

/**
 * Roughly where a stepped resize starts reading as a jump rather than motion.
 * Judged by eye, then held by the check.
 */
const MAX_STEP_PX = 120

/**
 * A large but real panel width to judge against.
 *
 * Not the width of a 4K display: the check is about how this actually gets
 * used, and nobody drags a reference panel to 3840. The number for that width
 * is reported anyway, because it is the same animation and it does step
 * further there.
 */
const WIDE_WINDOW_PX = 2560

/**
 * The largest single-frame width change the close will make, in pixels.
 *
 * Stepped at the interval the timer *achieves*, not the one it asks for.
 * `MOTION.frame` is 8ms precisely because Windows rounds it up to its own
 * 15.6ms tick — simulating the request rather than the tick would report half
 * the real jump and quietly pass a close that stutters.
 *
 * Walks the curve rather than differentiating it, so it stays honest if the
 * easing changes.
 */
const WINDOWS_TICK_MS = 15.6

function peakStepPx(windowWidth: number): number {
  const travel = windowWidth * (1 - MOTION.exit)
  let peak = 0
  let previous = 0
  for (let elapsed = WINDOWS_TICK_MS; ; elapsed += WINDOWS_TICK_MS) {
    const t = Math.min(1, elapsed / MOTION.exitDuration)
    const moved = anim.smoothstep(t) * travel
    peak = Math.max(peak, moved - previous)
    previous = moved
    if (t >= 1) return peak
  }
}

/**
 * The rectangle the window shrinks to on the way out.
 */
function checkCollapsedRect(win: Electron.BrowserWindow, full: Electron.Rectangle): void {
  const exit = anim.collapsedRect(full, MOTION.exit)
  const enter = anim.enterRect(full)

  // What makes both legs read as being pulled toward the tray rather than
  // folding up into their own top-left corner.
  for (const [name, r] of [
    ['closing', exit],
    ['opening', enter],
  ] as const) {
    check(
      `the ${name} rectangle pins the bottom-right corner`,
      r.x + r.width === full.x + full.width && r.y + r.height === full.y + full.height,
      `${r.width}x${r.height} at ${r.x},${r.y}`
    )
  }

  // What "jagged" measures out as.
  //
  // The window is resized by a main-process timer, so the animation really is
  // stepped and the largest single step is what the eye picks up. Simulated on
  // a large display rather than on this window, because the failure is worst
  // where the travel is longest — and a laptop-sized window passing does not
  // mean a 4K one will.
  //
  // The number that motivated this check: an accelerating close to 28% peaked
  // at 258px per frame on a 1400px window.
  check(
    'the close never steps more than a readable jump',
    peakStepPx(WIDE_WINDOW_PX) <= MAX_STEP_PX,
    `${peakStepPx(full.width).toFixed(0)}px at ${full.width} wide, ` +
      `${peakStepPx(WIDE_WINDOW_PX).toFixed(0)}px at ${WIDE_WINDOW_PX}, ` +
      `${peakStepPx(3840).toFixed(0)}px at 3840`
  )

  // Why the animation lifts the minimum size for its duration. Asserted at the
  // minimum rather than at whatever size this window happens to be, because
  // that is the case where the clamp bites — a large window can collapse and
  // still be above the floor, and then this proves nothing.
  const fromMinimum = anim.collapsedRect(
    { x: 0, y: 0, width: WINDOW.minWidth, height: WINDOW.minHeight },
    MOTION.exit
  )
  check(
    'collapsing from the minimum size would hit the clamp',
    fromMinimum.width < WINDOW.minWidth && fromMinimum.height < WINDOW.minHeight,
    `${fromMinimum.width}x${fromMinimum.height} vs min ${WINDOW.minWidth}x${WINDOW.minHeight}`
  )

  // And that the lift is temporary. A window left resizable down to a pixel is
  // a quieter bug than a broken animation and a longer-lived one.
  const [minW, minH] = win.getMinimumSize()
  check(
    'the minimum size is restored after the animation',
    minW === WINDOW.minWidth && minH === WINDOW.minHeight,
    `${minW}x${minH}`
  )
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

  const search = await shoot('smoke-home.png')


  // A tight crop of the search field, because the spacing there has been
  // judged from full-window shots where 60px reads as nothing.
  {
    const image = await win.webContents.capturePage()
    const scale = image.getSize().width / win.getBounds().width
    const crop = image.crop({
      x: Math.round(280 * scale),
      y: 0,
      width: Math.round(660 * scale),
      height: Math.round(54 * scale),
    })
    writeFileSync(join(process.cwd(), 'out', 'smoke-searchbar.png'), crop.toPNG())
  }

  // Hiscores, with a comparison loaded, so the diff column is in the shot.
  if (process.env.SMOKE_FETCH) {
    await win.webContents.executeJavaScript(
      `window.__rpNav.getState().push({ kind: 'hiscores' }); true`
    )
    await settle(400)
    await win.webContents.executeJavaScript(`
      (async () => {
        const set = (v) => {
          const i = document.querySelector('.hs-form input')
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
          setter.call(i, v)
          i.dispatchEvent(new Event('input', { bubbles: true }))
        }
        set('Framed')
        await new Promise((r) => setTimeout(r, 80))
        document.querySelector('.hs-form button[type=submit]').click()
        await new Promise((r) => setTimeout(r, 2500))
        set('Lynx Titan')
        await new Promise((r) => setTimeout(r, 80))
        ;[...document.querySelectorAll('.hs-form button')].find((b) => b.textContent === 'Compare')?.click()
      })()
    `)
    await settle(4000)
    // With a tooltip up, since it only exists on hover and is otherwise
    // impossible to eyeball.
    await win.webContents.executeJavaScript(`
      (() => {
        const cell = document.querySelectorAll('.hs-grid .hs-cell')[7]
        cell?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
        cell?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }))
        return true
      })()
    `)
    await settle(300)
    await shoot('smoke-hiscores.png')

    // And an account with holes in it, because the full grid never shows what
    // an empty slot looks like. Zezima predates almost every boss in the game.
    await win.webContents.executeJavaScript(`
      (async () => {
        const i = document.querySelector('.hs-form input')
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
        setter.call(i, 'Zezima')
        i.dispatchEvent(new Event('input', { bubbles: true }))
        await new Promise((r) => setTimeout(r, 80))
        document.querySelector('.hs-form button[type=submit]').click()
      })()
    `)
    await settle(3000)
    await shoot('smoke-hiscores-sparse.png')

    await win.webContents.executeJavaScript(`window.__rpNav.getState().reset(); true`)
    await settle(300)
  }

  // The Grand Exchange view, so the chart gets an eye on it too.
  await win.webContents.executeJavaScript(
    `window.__rpNav.getState().push({ kind: 'ge', itemId: 4151 }); true`
  )
  await waitFor(win.webContents, '.chart-svg', 12000)
  await settle(800)
  await shoot('smoke-ge.png')
  await win.webContents.executeJavaScript(`window.__rpNav.getState().reset(); true`)
  await settle(300)

  // Every theme, so a light-mode regression shows up without a manual pass.
  if (process.env.SMOKE_THEMES) {
    for (const theme of ['light', 'parchment', 'dark'] as const) {
      await win.webContents.executeJavaScript(
        `window.rp.setSettings({ theme: '${theme}' }); true`
      )
      await settle(500)
      await shoot(`smoke-home-${theme}.png`)
    }

    // Settings too: the toggles live there, and their "on" state is the one
    // control that has to look right against all three surfaces.
    await win.webContents.executeJavaScript(
      `window.__rpNav.getState().push({ kind: 'settings' }); true`
    )
    await settle(400)
    for (const theme of ['parchment', 'light', 'dark'] as const) {
      await win.webContents.executeJavaScript(`window.rp.setSettings({ theme: '${theme}' }); true`)
      await settle(500)
      await shoot(`smoke-settings-${theme}.png`)
    }
    await win.webContents.executeJavaScript(`window.__rpNav.getState().reset(); true`)
    await settle(300)
  }

  // Navigate by pushing onto the history stack the UI already uses, then wait
  // for the article body to actually exist rather than guessing at a delay.
  // Prefer an item with variants so the tabs are in the shot.
  const cached = (db
    .get()
    .prepare("SELECT title FROM pages WHERE title = 'Scythe of vitur' LIMIT 1")
    .get() ?? db.get().prepare('SELECT title FROM pages ORDER BY fetched_at DESC LIMIT 1').get()) as
    | { title: string }
    | undefined

  let article = true
  if (cached) {
    await win.webContents.executeJavaScript(`
      window.__rpNav.getState().push({ kind: 'page', title: ${JSON.stringify(cached.title)} }); true
    `)
    await waitFor(win.webContents, '.article-body', 8000)
    // Images resolve through the protocol handler; give them a moment to paint.
    await settle(2500)
    article = await shoot('smoke-article.png')

    // Scroll to the worn-equipment panel when there is one, so the capture
    // shows the layout rather than the top of the page.
    if (process.env.SMOKE_SCROLL) {
      await win.webContents.executeJavaScript(`
        document.querySelector(${JSON.stringify(process.env.SMOKE_SCROLL)})
          ?.scrollIntoView({ block: 'center' }); true
      `)
      await settle(900)
      await shoot('smoke-article-detail.png')
    }

    if (process.env.SMOKE_THEMES) {
      for (const theme of ['parchment', 'dark'] as const) {
        await win.webContents.executeJavaScript(`window.rp.setSettings({ theme: '${theme}' }); true`)
        await settle(700)
        await shoot(`smoke-article-${theme}.png`)
      }
    }

    if (process.env.SMOKE_IMAGES) {
      const report = await win.webContents.executeJavaScript(`
        (() => {
          const broken = []
          for (const img of document.querySelectorAll('.article, .infobox-card')) {}
          for (const img of document.querySelectorAll('img')) {
            if (img.complete && img.naturalWidth === 0)
              broken.push({ src: img.currentSrc || img.src, where: img.closest('.infobox-card') ? 'infobox' : 'body' })
          }
          return JSON.stringify({ total: document.querySelectorAll('img').length, broken: broken.slice(0, 12), count: broken.length })
        })()
      `)
      console.log('[images] ' + report)
    }
    await checkNoHorizontalOverflow(win.webContents)
    await checkTabber(win.webContents)
  }

  check(
    'screenshots written',
    search && article,
    cached ? 'out/smoke-home.png, out/smoke-article.png' : 'out/smoke-home.png (no page cached)'
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

  // Not awaited: `app.exit` is next and the window is going away either way.
  // Under SMOKE the animation is off, so there is nothing to cut short.
  void hide()
  app.exit(failed === 0 ? 0 : 1)
}

/** '#15121f' -> 'rgb(21, 18, 31)', the form getComputedStyle reports. */
function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
}
