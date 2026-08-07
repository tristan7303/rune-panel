/**
 * The embedded third-party tools.
 *
 * Three of the six modules are somebody else's website shown inside our window:
 * the wiki's DPS calculator, the wiki's own calculator pages, and RuneProfile.
 * Reimplementing any of them would be worse — the DPS engine alone is 100 KB of
 * accumulated edge cases, and RuneProfile's UI is the reason for using it.
 *
 * What this file owns is the difference between "an iframe" and "part of the
 * app": which chrome to hide, how to make each site render dark, and where each
 * one is allowed to navigate.
 *
 * All three are somebody else's HTML and will be redeployed without warning.
 * Every selector here is therefore chosen to be as structural as possible, and
 * the whole injection can be switched off in settings so a broken selector
 * degrades to the plain site rather than a blank pane.
 */

import type { Theme } from '../../shared/ipc'

export interface ToolCookie {
  url: string
  name: string
  value: string
}

/**
 * The app's surfaces, as literal colours.
 *
 * The pane is a separate origin and cannot read our CSS variables, so the
 * values have to travel with the injection. Alpha is resolved here too — these
 * composite onto their own page, not onto our acrylic.
 */
export interface ToolPalette {
  /** True when the host app is in a dark theme. */
  dark: boolean
  surface: string
  raised: string
  sunken: string
  rim: string
  text: string
  textDim: string
  accent: string
}

export const PALETTES: Record<Theme, ToolPalette> = {
  dark: {
    dark: true,
    surface: '#15121f',
    raised: '#221e33',
    sunken: '#0d0b14',
    rim: '#332e46',
    text: '#eeecf8',
    textDim: '#9d99b0',
    accent: '#b39bff',
  },
  // Flattened from the translucent tokens in styles.css: an embedded page needs
  // opaque hex, and the alpha these carry over the window backdrop has to be
  // resolved to a single colour here.
  mocha: {
    dark: true,
    surface: '#2b211a',
    raised: '#3b2e24',
    sunken: '#1c1510',
    rim: '#4d3d30',
    text: '#f5e9d8',
    textDim: '#a3927f',
    accent: '#d0a86a',
  },
  parchment: {
    dark: false,
    surface: '#e8dcc4',
    raised: '#f4ebd7',
    sunken: '#d6c7aa',
    rim: '#b8a582',
    text: '#302414',
    textDim: '#6b5c44',
    accent: '#7a4bb8',
  },
  light: {
    dark: false,
    surface: '#e2e0ea',
    raised: '#f0eff5',
    sunken: '#d0cddb',
    rim: '#b9b5c6',
    text: '#141220',
    textDim: '#5a566b',
    accent: '#6d4fd6',
  },
}

export interface ToolDef {
  id: ToolId
  label: string
  /** `arg` carries the RuneProfile username, or a calculator page title. */
  url: (arg?: string) => string
  /** Injected after load: hide chrome, match the theme. */
  css?: (palette: ToolPalette) => string
  /**
   * Cookies to set before the first load. Cheaper and far more robust than
   * restyling someone else's light theme by hand.
   */
  cookies?: ToolCookie[]
  /**
   * Run before the CSS lands — used to put a site into the light or dark mode
   * that matches ours, so the injected palette is not fighting the page.
   */
  js?: (palette: ToolPalette) => string
  /** In-pane navigation is confined to this; everything else opens externally. */
  allowNavigation: RegExp
}

export type ToolId = 'dps' | 'calculators' | 'profile'

/**
 * The wiki's DPS calculator.
 *
 * A Next.js app that already defaults to dark — an inline script reads
 * `localStorage.theme` and falls back to `dark`, so nothing is needed there.
 * Its class names are plain Tailwind utilities rather than hashed CSS modules,
 * which makes them readable but not stable, so the header and footer are
 * matched by `:has()` on the content inside them instead.
 */
const DPS: ToolDef = {
  id: 'dps',
  label: 'DPS calculator',
  url: () => 'https://tools.runescape.wiki/osrs-dps/',
  css: (p) => `
    /* The header carries the wiki logo, the "DPS Calculator" h1 and a Discord
       link — all redundant inside an app whose title bar already says where
       you are. Matched via the h1 rather than by class, so a restyle does not
       silently un-hide it. */
    main > div:first-child:has(h1) { display: none !important; }

    /* Footer: copyright, commit hash, privacy and terms. */
    body > main > div:last-child:has(a[href*="weirdgloop.org"]) { display: none !important; }

    /* Reclaim the height the header occupied. */
    main { height: 100vh !important; }

    /*
     * Repaint their palette with ours.
     *
     * The calculator is Tailwind with a custom scale — dark-100..500 for its
     * dark surfaces, body-* and btns-400 for its light ones — compiled to
     * literal hex, so there are no variables to override and every utility has
     * to be restated. Both scales are covered rather than only the active one:
     * the page decides its own mode, and a half-themed pane is worse than an
     * unthemed one.
     */
    html, body { background: ${p.surface} !important; color: ${p.text} !important; }

    .bg-dark-500, .bg-btns-400 { background-color: ${p.sunken} !important; }
    .bg-dark-400, .bg-body-100 { background-color: ${p.surface} !important; }
    .bg-dark-300, .bg-dark-200, .bg-dark-100,
    .bg-body-200, .bg-body-400 { background-color: ${p.raised} !important; }

    [class*='border-dark-'], [class*='border-body-'], [class*='border-gray-'] {
      border-color: ${p.rim} !important;
    }

    .text-dark-100, .text-body-200, .text-gray-300 { color: ${p.textDim} !important; }

    /* Form controls inherit none of the above on their own. */
    input, select, textarea { background-color: ${p.sunken} !important; color: ${p.text} !important; border-color: ${p.rim} !important; }

    /* Their orange is a highlight, not a surface; it becomes our accent. */
    .bg-orange-700, .bg-orange-400 {
      background-color: ${p.accent} !important;
      color: ${p.dark ? '#1a1626' : '#ffffff'} !important;
    }
  `,
  // Their own theme script reads localStorage and toggles a `dark` class. Set
  // both so the page starts in the mode our palette is written for, rather than
  // flipping to it after paint.
  js: (p) => `
    try {
      localStorage.setItem('theme', ${JSON.stringify(p.dark ? 'dark' : 'light')});
      document.documentElement.classList.toggle('dark', ${String(p.dark)});
      document.documentElement.classList.toggle('light', ${String(!p.dark)});
    } catch (e) {}
  `,
  allowNavigation: /^https:\/\/tools\.runescape\.wiki\//,
}

/**
 * The wiki's own calculator pages.
 *
 * These need MediaWiki's JavaScript to compute anything, so they cannot go
 * through the article transform — they have to be the real page. Hiding the
 * skin leaves the calculator itself.
 *
 * The wiki renders light by default. A `theme=dark` cookie flips it
 * server-side, which is worth far more than any amount of injected CSS: the
 * page arrives already dark instead of flashing white and then being patched.
 */
const CALCULATORS: ToolDef = {
  id: 'calculators',
  label: 'Calculators',
  url: (page) =>
    `https://oldschool.runescape.wiki/w/${encodeURIComponent((page ?? 'Calculator:Smithing').replace(/ /g, '_'))}`,
  cookies: [
    { url: 'https://oldschool.runescape.wiki', name: 'theme', value: 'dark' },
  ],
  css: () => `
    /* Vector-legacy skin chrome: the sidebar, the tab strip, the personal
       tools, the site footer. Ids, not classes — MediaWiki ids are part of its
       public skin contract and change far less often than styling. */
    #mw-navigation, #mw-head, #mw-panel, #footer, #p-personal,
    #siteNotice, #catlinks, #contentSub, #jump-to-nav,
    .mw-indicators, .mw-editsection, .noprint { display: none !important; }

    /* With the sidebar gone the content column is still indented for it. */
    #content, #mw-page-base, #mw-head-base {
      margin-left: 0 !important;
      border: 0 !important;
      padding-top: 12px !important;
    }
    body { padding: 0 !important; }
  `,
  allowNavigation: /^https:\/\/oldschool\.runescape\.wiki\//,
}

/**
 * RuneProfile.
 *
 * Their UI is the point — it already ships dark, renders server-side, and has
 * its own Skills / Quests / Diaries / Combat Achievements / Collection Log
 * tabs. The only thing worth removing is the site footer; a profile page has no
 * header of its own. Our native search page supplies the entry point.
 */
const PROFILE: ToolDef = {
  id: 'profile',
  label: 'RuneProfile',
  url: (username) => `https://www.runeprofile.com/${encodeURIComponent(username ?? '')}`,
  css: () => `
    /* A real <footer> element — Discord, Ko-fi, GitHub, Jagex attribution. */
    body > div > footer, footer { display: none !important; }
  `,
  allowNavigation: /^https:\/\/(www\.)?runeprofile\.com\//,
}

export const TOOLS: Record<ToolId, ToolDef> = {
  dps: DPS,
  calculators: CALCULATORS,
  profile: PROFILE,
}
