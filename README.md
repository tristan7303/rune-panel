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
| 1 | SQLite storage, throttled wiki client, title index | |
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

**Alt+Shift+Space** opens and closes it. Escape closes it too. The tray icon
opens it and is the only way to quit.

Not Ctrl+Shift+Space, which is glass-agent's. Global accelerators are
first-come-first-served: whichever app launches first wins the binding and the
other silently has no hotkey at all. Change it in settings if you like.

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

Article views carry the required CC BY-NC-SA attribution and link back to the
live page. The licence is non-commercial: do not sell this.

## Layout

```
src/
  main/            Electron main
    window.ts      frameless acrylic window, hotkey show/hide
    tray.ts        tray + menu
    settings.ts    JSON persistence in userData
    smoke.ts       SMOKE=1 self-check
  preload/         the entire renderer-facing API surface
  shared/          types and channel names used by both processes
  renderer/src/    React UI — shell, rail, settings
scripts/           tray icon generator (pure Node, no deps)
```
