# Rune Buddy

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
| 2 | Shell UI, navigation history, Ctrl+K search | |
| 3 | Article renderer and HTML transform | |
| 4 | Background sync: recentchanges + seed crawler | |
| 5 | Embedded tool pane: DPS, calculators, RuneProfile | |
| 6 | Grand Exchange prices | |
| 7 | Hiscores lookup and compare | |
| 8 | Packaging | |

Plan lives in `~/.claude/plans/please-copy-glass-agent-vast-rabin.md`.

## Running

```sh
npm install
npm run icon      # generates resources/tray.png
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

`SMOKE_SHOT=1` also writes `out/smoke-shot.png`.

## Two things that shape the architecture

**Open or closed, never idling.** There is no ambient orb. That one decision
removes the click-through hit testing, the z-order sinking, the custom cursor,
and `setContentProtection` that a persistent transparent HUD needs — and it is
why Rune Buddy stays visible in OBS and Discord, unlike its parent.

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
      titles.ts    the 41k-article / 203k-redirect search index
  preload/         the entire renderer-facing API surface
  shared/          types and channel names used by both processes
  renderer/src/    React UI — shell, rail, settings
scripts/           tray icon generator (pure Node, no deps)
```

`wiki/client.ts` is the single choke point for every outbound request in the
app, price API included. One global 4 req/s ceiling is stricter than either host
needs, but it means a background crawl can never outpace or starve anything, and
interactive work jumps the queue regardless.
