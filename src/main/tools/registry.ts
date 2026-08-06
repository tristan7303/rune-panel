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

export interface ToolCookie {
  url: string
  name: string
  value: string
}

export interface ToolDef {
  id: ToolId
  label: string
  /** `arg` carries the RuneProfile username, or a calculator page title. */
  url: (arg?: string) => string
  /** Injected after load: hide chrome, match the theme. */
  css?: string
  /**
   * Cookies to set before the first load. Cheaper and far more robust than
   * restyling someone else's light theme by hand.
   */
  cookies?: ToolCookie[]
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
  css: `
    /* The header carries the wiki logo, the "DPS Calculator" h1 and a Discord
       link — all redundant inside an app whose title bar already says where
       you are. Matched via the h1 rather than by class, so a restyle does not
       silently un-hide it. */
    main > div:first-child:has(h1) { display: none !important; }

    /* Footer: copyright, commit hash, privacy and terms. */
    body > main > div:last-child:has(a[href*="weirdgloop.org"]) { display: none !important; }

    /* Reclaim the height the header occupied. */
    main.flex.h-\\[100vh\\], main { height: 100vh !important; }
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
  css: `
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
  css: `
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
