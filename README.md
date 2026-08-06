![Rune Panel](images/rune-panel-banner.png)

# Rune Panel

An all-in-one Old School RuneScape companion for Windows. Press a hotkey and the
whole wiki is there — over your game, over your browser, wherever you are — plus
the DPS calculator, Grand Exchange prices, hiscores and RuneProfile.

Pages you have read open instantly from your own machine.

---

## Install

Download the installer from
[Releases](https://github.com/tristan7303/rune-panel/releases) and run it.

Windows shows **"Windows protected your PC"** the first time, because the
installer is not code-signed. Click **More info** → **Run anyway**. You will only
see it once — updates after that are handled in-app.

On first launch it asks to download the wiki's page list. That takes about four
minutes and it shows you where it is up to. Nothing works properly until it
finishes.

## Using it

| | |
|---|---|
| **Ctrl+Shift+Space** | Open or close, from anywhere |
| **Ctrl+F** | Search the wiki |
| **Esc** | Back a step, then close |
| **Alt+←** / **Alt+→** | Back and forward |

The rail on the left switches between the DPS calculator, prices, hiscores,
calculators and RuneProfile. The mark at the top goes home; the sliders at the
bottom are settings.

It stays on top of the game, including a borderless-fullscreen client, and does
not close when you click away. Both are settings if you want otherwise.

The tray icon is the only way to quit.

## Updates

Rune Panel checks for a new version shortly after launch and once a day after
that. A strip appears at the top of the window when one exists — nothing
downloads or installs until you click it, and it will never restart itself while
you are using it.

## Where it keeps things

Everything lives in `%APPDATA%\rune-panel` — the page cache, the search index,
the images and your settings. No account, no telemetry. Deleting that folder
resets the app.

---

## Building from source

Needs [Node.js](https://nodejs.org) 20 or newer.

```sh
npm install
npm run build
npx electron out/main/index.js     # run it
npm run dist                       # or build an installer into release/
```

Checks: `npm run typecheck`, and `SMOKE=1 npx electron out/main/index.js` — the
second asserts real behaviour through the app's own IPC bridge.

### Cutting a release

```sh
npm version 0.1.1 -m "Release %s"
git push --follow-tags
```

CI builds on Windows and uploads to a **draft** GitHub Release. Review it, then
publish — that is what ships it to everyone's updater.

Auto-update needs the repository to stay **public**. `electron-updater` checks
releases unauthenticated; against a private repo GitHub answers 404 and every
install silently reports "no updates" forever.

Signing is wired but unset. Supply `CSC_LINK` and `CSC_KEY_PASSWORD` as
environment variables, or repository secrets for CI, and builds sign with no
code change.

---

## Data and licence

| | |
|---|---|
| Articles, images, calculators | [OSRS Wiki](https://oldschool.runescape.wiki) |
| Item data and prices | [prices.runescape.wiki](https://prices.runescape.wiki) |
| DPS calculator | [tools.runescape.wiki/osrs-dps](https://tools.runescape.wiki/osrs-dps/) |
| Hiscores | Jagex |
| Profiles | [RuneProfile](https://www.runeprofile.com) |

Wiki content is licensed
[CC BY-NC-SA 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/), credited
and linked on every article page. That licence is **non-commercial** — Rune Panel
is free and personal, and selling it would not be allowed.

The wiki asks automated clients to identify themselves, so every request carries
a descriptive User-Agent with the contact address from settings. Worth filling
in.

Rune Panel is not affiliated with Jagex or the OSRS Wiki. Old School RuneScape is
a trademark of Jagex Ltd.
