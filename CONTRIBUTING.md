# Contributing to Rune Panel

How the code is arranged and why. For what the app *does*, see the
[README](README.md).

An all-in-one Old School RuneScape desktop tool for Windows: a hotkey-summoned
window that is, mostly, a fast private UI over the OSRS Wiki — plus the DPS
calculator, Grand Exchange prices, hiscores, and RuneProfile.

Forked from `glass-agent` for its shell, IPC contract, and visual language. The
agent, the embedded browser, and the WebGL refraction engine are gone.

## Status

| Phase | | |
|---|---|---|
| 0 | Fork, acrylic window, hotkey, tray, settings | done |
| 1 | SQLite storage, throttled wiki client, title index | done |
| 2 | Shell UI, navigation history, Ctrl+K search | done |
| 3 | Article renderer and HTML transform | done |
| 4 | Background sync: recentchanges + seed crawler | done |
| 5 | Embedded tool pane: DPS, calculators, RuneProfile | done |
| 6 | Grand Exchange prices | done |
| 7 | Hiscores lookup and compare | done |
| 8 | Packaging | done |

Plan lives in `~/.claude/plans/please-copy-glass-agent-vast-rabin.md`.

## Running

```sh
npm install
npm run dev       # HMR
```

Or build and run the real thing:

```sh
npm run build
npx electron out/main/index.js
```

**Ctrl+Shift+Space** opens and closes it. Escape closes it too. The tray icon
opens it and is the only way to quit.

Global accelerators are first-come-first-served: if another app already holds
the binding, registration fails with nothing but a console warning and the
hotkey silently does nothing. Change it in settings if that happens.

## Verifying

```sh
npm run build && SMOKE=1 npx electron out/main/index.js
```

Asserts the acceptance criteria and exits non-zero on failure. A frameless
window shows nothing useful in a terminal and a screenshot cannot tell you
whether the preload bridge connected, so the checks assert behaviour directly —
including a settings write driven through the real IPC bridge and a full
show/hide cycle closed from the renderer.

`SMOKE_SHOT=1` also writes `out/smoke-search.png` and `out/smoke-article.png`,
driven through the renderer's own navigation store. Deliberately not synthetic
keystrokes: global input automation types into whatever window happens to have
focus, which is not reliably this one.

`SMOKE_FETCH=1` lets the article checks fetch one page when nothing is cached
yet. Off by default — a smoke run should not make wiki requests every time.

## Two things that shape the architecture

**Open or closed, never idling.** There is no ambient orb. That one decision
removes the click-through hit testing, the z-order sinking, the custom cursor,
and `setContentProtection` that a persistent transparent HUD needs — and it is
why Rune Panel stays visible in OBS and Discord, unlike its parent.

**Nothing depends on the blur.** The frosted look is `backgroundMaterial:
'acrylic'`, the DWM system backdrop, which needs `transparent: false` and a
zero-alpha `backgroundColor` and is only available on Windows 11 22H2+. The
surface colours in `styles.css` are near-opaque on their own, so a machine where
DWM declines still gets a correct-looking window — and dense wiki text stays
legible over any wallpaper or game client. Acrylic adds depth; it never carries
the design.

The smoke test cannot confirm the backdrop: Electron exposes no getter, and
`capturePage` renders the web contents only — the system backdrop lives behind
them and never appears in the capture. Confirming it means capturing the
*screen* while the window is up and looking for the blur. Verified working on a
frameless window here; the fallback exists for machines where it is not.

## Data sources

| | |
|---|---|
| Wiki content | `oldschool.runescape.wiki/api.php` — CC BY-NC-SA 3.0, **non-commercial** |
| Item metadata and prices | `prices.runescape.wiki/api/v1/osrs` |
| DPS calculator | `tools.runescape.wiki/osrs-dps` (embedded) |
| Hiscores | `secure.runescape.com/m=hiscore_oldschool` |
| Profiles | `runeprofile.com` (embedded) and `api.runeprofile.com/v1` |

The wiki does not rate limit, but it does ask automated clients to identify
themselves. Every outgoing request carries a descriptive User-Agent, and the
contact address in it comes from settings — fill it in.

### The title index

```sh
npm run build
npm run sync:titles              # the real thing, ~4 minutes
npm run sync:titles -- --dry-run # 6 requests, proves the shapes parse
```

Measured on a full run: **239,057 titles — 35,680 articles and 203,377
redirects** — in 884 requests over 246s, sustained at 3.6 req/s with zero
retries and zero failures.

That is far more than the wiki's own "41,244 articles" statistic suggests, in
two ways worth knowing. The statistic counts every content namespace, while the
index takes namespace 0 only, so the article count is lower. And OSRS pages
carry an extraordinary number of aliases — 5.7 redirects per article, most of
them misspellings (`Abhssal whip`, `Abbysal whip`) — so redirects dominate both
the row count and the request count. Search in phase 2 has to rank around that,
not just match against it.

The sync runs automatically on first launch and weekly thereafter, at background
priority so anything you do jumps ahead of it.

### Search

**Ctrl+K** from anywhere. Search runs in main over an in-memory copy of the
index — measured at 6–12ms across the full 239k rows, so there is no debounce
and no worker; every keystroke queries.

The interesting problem is not matching, it is **collapsing**. A raw match for
`aby` returns 1,108 rows that are really a few dozen articles wearing hats, so
every hit resolves to its canonical article and dedupes. That turns the wiki's
enormous redirect table from noise into precisely the typo tolerance you want —
it has already written down every misspelling anyone makes. On top of that,
single-error tolerance costs nothing measurable (11ms vs 12ms) and rescues
what strict matching drops outright: `dragn scim` goes from 0 hits to 57.

Two subtleties that took a bug each to find. The alias shown as "matched …" is
chosen *during* dedupe, preferring an exact match — otherwise `bowfa` collapses
to `Bow of faerdhinen` but reports having matched `BOWFA RANGE`. And an exact
title is promoted to the top afterwards, because fuzzy ranking will otherwise
put `Zulrah/Strategies` above `Zulrah`.

### Articles

Fetched once via `action=parse`, transformed once in main, cached forever. Every
later visit is a disk read, and hovering a link for 150ms prefetches it, so a
click is almost always local.

The transform (`wiki/transform.ts`) is what separates this from an embedded
browser: it sanitizes, lifts the infobox out into structured data the renderer
draws as a native panel, rewrites `/w/` links to `rp://` routes, points every
image at the local cache, and strips the navboxes and cross-wiki chrome. The
output is injected with `dangerouslySetInnerHTML`, so script tags, inline
handlers and `javascript:` URLs are removed — "trusted source" is not a security
model, and the smoke suite asserts each of those individually.

Images go through `rpimg://`, backed by a hashed, two-level-sharded on-disk
cache. Two things about it are not obvious. Article pages are far more
image-dense than they look — the Abyssal whip page references **183** — so
images deliberately bypass the API's 4 req/s ceiling, which exists for
`api.php`, not for static bytes behind a CDN; a concurrency cap of 8 replaces
it. And the URL carries a constant `img` host (`rpimg://img/<name>`) because a
`standard` scheme parses `rpimg://thumb/X.png/130px-X.png` with `thumb` as the
host, lowercases it, and drops it from the path — thumbnails are exactly the
case that breaks.

**Known gap:** weapon and spell sound effects are stripped. They cannot play —
the renderer has no `media-src` and the asset protocol serves images only — and
a dead player control is worse than none. Supporting them is a small separate
change.

### Staying current

```sh
npm run crawl        # refresh what is stale, then fill the seed list
```

Invalidation asks the wiki what changed rather than checking what we hold.
Polling revision ids across tens of thousands of cached pages would be thousands
of requests; `list=recentchanges` answers it in one, because the wiki already
keeps that list. Changed pages are *marked*, never dropped — a stale page still
renders instantly with a note and refreshes on next view.

The crawler runs on launch and fills a short hand-picked seed list (every skill,
the raids, the common bosses). It is deliberately not a full mirror: what you
visit is a better predictor of what you want than any heuristic worth writing.
It runs at 500ms between pages, and **parks entirely whenever the window is
visible** — bandwidth and the request queue belong to the page you are actually
reading. Measured: 46 seed pages in 36s at 1.49 req/s, zero failures.

Two measurements worth knowing before this scales:

- **Articles are large.** 47 cached pages hold 12 MB of HTML — ~255 KB each, and
  those seeds skew big (Slayer task is 363 KB). Stored uncompressed. Caching the
  whole wiki this way would run to several GB, which is one more reason the
  design caches what you read rather than everything.
- **The crawler caches HTML, not images.** Images are fetched by the renderer
  when a page is actually displayed, so a crawled page still pulls its icons on
  first view. That is the right trade — prefetching 183 images per page across
  the seed list would be tens of thousands of requests — but it does mean this
  is not an offline mirror.

**Invariant worth relying on:** a redirect's target is either NULL or a title
that exists locally. A few redirects point off-wiki entirely (`Api` resolves to
`rsw:Application programming interface` on the RS3 wiki); their targets are
cleared at the end of a sync so nothing downstream can follow a redirect into a
page that cannot be rendered. The redirect's own title stays searchable.

Article views carry the required CC BY-NC-SA attribution and link back to the
live page. The licence is non-commercial: do not sell this.

## Layout

```
src/
  main/            Electron main
    window.ts      frameless acrylic window, hotkey show/hide
    tray.ts        tray + menu
    settings.ts    JSON persistence in userData
    db.ts          node:sqlite — schema, migrations, kv helpers
    sync-cli.ts    --sync-titles headless runner
    smoke.ts       SMOKE=1 self-check
    wiki/
      client.ts    the only outbound request path: UA, queue, retries
      titles.ts    the 36k-article / 203k-redirect index
      search.ts    uFuzzy matching + alias collapsing
      page.ts      article fetch + cache
      transform.ts MediaWiki HTML -> our HTML, and the infobox
      images.ts    rpimg:// protocol + on-disk image cache
      sync.ts      recentchanges invalidation + background crawler
    prices/
      ge.ts        mapping / latest / timeseries, cached
    hiscores/
      index.ts     account-type probing + the four boards
  preload/         the entire renderer-facing API surface
  shared/          types and channel names used by both processes
  renderer/src/
    App.tsx        shell: rail, top bar, routed body
    nav.ts         history stack — a tagged union, not a router
    Search.tsx     the Ctrl+K palette
    Article.tsx    article view, infobox, hover prefetch
    article.css    restyling of the wiki's own markup
    Settings.tsx   settings view
    tools/
      registry.ts  per-site chrome hiding, theming, nav guards
      pane.ts      the single reusable WebContentsView
      profile.ts   RuneProfile account lookup
images/            banner and logo artwork
resources/icon.png the app, window and tray icon
```

`wiki/client.ts` is the single choke point for every outbound request in the
app, price API included. One global 4 req/s ceiling is stricter than either host
needs, but it means a background crawl can never outpace or starve anything, and
interactive work jumps the queue regardless.


## Releasing

```sh
npm run dist      # build an installer into release/, publish nothing
npm run release   # build and upload to a draft GitHub Release
```

CI does the second on any `v*` tag:

```sh
npm version 0.1.1 -m 'Release %s'   # bumps package.json and tags
git push --follow-tags
```

The workflow builds on `windows-latest` and uploads to a **draft** release, so a
bad build can be deleted before anyone's updater sees it. Publishing the draft is
what actually ships it.

Three things that have to stay true or auto-update breaks silently:

- **The repository must be public.** `electron-updater` checks releases
  unauthenticated; against a private repo GitHub answers 404 and the app reports
  "no updates" forever, with no error anywhere.
- **`latest.yml` must ship with the installer.** electron-builder writes it into
  `release/` and uploads it; it is the feed the updater reads.
- **The artifact name must not contain spaces.** `artifactName` in
  `electron-builder.yml` pins it, because the default lands on disk with spaces
  while the feed refers to the URL-encoded form — two names for one file.

Signing is wired but unset. Supply `CSC_LINK` (a .pfx path or its base64) and
`CSC_KEY_PASSWORD` as environment variables, or as repository secrets for CI,
and builds sign with no code change.
