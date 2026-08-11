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

import type { Theme, ToolId } from '../../shared/ipc'

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

/**
 * Re-exported rather than declared again.
 *
 * This file used to keep its own copy of the union, which meant adding a tool
 * required remembering to widen it in two places — and the two disagreeing
 * would have compiled fine on one side of the bridge and failed on the other.
 */
export type { ToolId }

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
  // The argument is a shortlink id — how the RuneLite plugin hands over a
  // loadout: the bridge stores it with the wiki's shortlink service and the
  // calculator restores it from `?id=`.
  url: (id) =>
    id
      ? `https://tools.runescape.wiki/osrs-dps/?id=${encodeURIComponent(id)}`
      : 'https://tools.runescape.wiki/osrs-dps/',
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

/**
 * GE Tracker.
 *
 * Live margins and price history for every item. There is an API, but it is a
 * paid one, so this embeds the site rather than reimplementing it — the same
 * bargain as the DPS calculator and RuneProfile above.
 *
 * Unlike those two it has no dark mode of its own to switch into, so the palette
 * has to be applied by hand. The injection is deliberately shallow: broad
 * surface and text rules keyed off structural selectors, not a reconstruction of
 * their stylesheet. A site this size will be restyled without warning and a
 * hundred brittle rules would fail one at a time and invisibly; these fail
 * together and obviously, and the whole injection is switchable off in settings.
 *
 * Ads and the sticky sidebar go. They are not chrome we are entitled to remove
 * on principle — they are how the site is funded — but this is a private,
 * personal client with no browser around it, and a 300px ad rail inside a 1180px
 * panel leaves no room for the table you came for.
 */
const GETRACKER: ToolDef = {
  id: 'getracker',
  label: 'GE Tracker',
  /**
   * An item slug, or a bare path when the argument already contains a slash.
   *
   * Item pages are the overwhelming case and get the `item/` prefix for free;
   * the exception is sign-in, which is a page rather than an item and would
   * otherwise need a second argument on the route to express.
   */
  url: (arg) =>
    `https://www.ge-tracker.com/${!arg ? '' : arg.includes('/') ? arg : `item/${arg}`}`,
  css: (p) => `
    /**
     * Surfaces.
     *
     * The app pages are built on Gentelella, a Bootstrap admin template, so the
     * containers have its names rather than generic ones — \`right_col\` is the
     * content area, \`x_panel\` a card, \`x_title\` its heading. Naming them is
     * what makes this a theme rather than a wash: an earlier version set a light
     * text colour on \`body\` and matched no containers, so every card kept its
     * white background and the text on it became invisible.
     */
    html, body, .right_col, .container.body, .main_container, .main-content {
      background: ${p.surface} !important;
      color: ${p.text} !important;
    }

    .x_panel, .graph-info-panel, .card, .panel, .well, .modal-content,
    .dropdown-menu, .list-group-item, .tile_count, .dashboard_graph {
      background-color: ${p.raised} !important;
      color: ${p.text} !important;
      border-color: ${p.rim} !important;
    }

    .x_title { border-bottom-color: ${p.rim} !important; }

    /**
     * Everything above the item name goes.
     *
     * Their top strip is a second search box for a page this app reaches by
     * searching, and the block under it is a premium advertisement. Neither is
     * content, and together they cost the first 280px of every item page.
     *
     * That takes the sign-in link with it, so the tool bar above the pane grows
     * its own — see GeTracker.tsx. Better than keeping a whole bar for one
     * link most people press once.
     */
    .top_nav, .nav_menu { display: none !important; }

    /* The premium trial pitch. Their own id for it, rather than the wording,
       which is seasonal — and rather than "the first row", which would take a
       real one out with it the moment they reorder the page. */
    #welcome_guest { display: none !important; }

    /**
     * The sidebar goes, and the content takes the width back.
     *
     * It is 230px of their own navigation — Flip Finder, Money Making,
     * Leaderboard — which are whole sections of a site this window is not
     * pretending to be. What this page is for is one item at a time, reached by
     * the search above it, and in an 1180px panel that column is a fifth of the
     * width spent on links out of the thing you came to read.
     *
     * "right_col" is positioned with a hard left margin to clear it, so hiding
     * one without the other leaves the gap behind.
     */
    .left_col, .nav_title { display: none !important; }
    .right_col, .top_nav { margin-left: 0 !important; }

    table, .table { color: ${p.text} !important; }

    .table > tbody > tr > td, .table > thead > tr > th, table td, table th {
      border-color: ${p.rim} !important;
    }

    thead, .table > thead > tr > th, .panel-heading, .card-header {
      background-color: ${p.sunken} !important;
      color: ${p.textDim} !important;
    }

    /**
     * The price chart is Plotly, which draws to SVG and paints its own white
     * plate underneath — so the surrounding card going dark leaves a white
     * rectangle in the middle of it. The plate is a \`rect\` rather than a CSS
     * background, hence \`fill\` rather than \`background\`.
     */
    svg.main-svg { background: transparent !important; }
    .main-svg .bg { fill: ${p.raised} !important; }
    .main-svg .gridlayer path { stroke: ${p.rim} !important; }
    .main-svg text { fill: ${p.textDim} !important; }

    /* Their link green is fixed, and reads as either invisible or neon
       depending on which of our four themes is behind it. */
    a, a:hover, a:focus, .green-links a { color: ${p.accent} !important; }

    .text-muted, small, .help-block { color: ${p.textDim} !important; }

    input, select, textarea, .form-control, .bootstrap-tagsinput {
      background-color: ${p.sunken} !important;
      color: ${p.text} !important;
      border-color: ${p.rim} !important;
    }

    /**
     * Their top bar stays.
     *
     * The other panes hide site chrome because it is branding we already draw.
     * This one is different: that bar is where you sign in, and the useful half
     * of GE Tracker is behind an account. Hiding it would leave no way to reach
     * one, in a window with no address bar to work around it.
     */

    /* The footer is safe to drop — links and copyright, nothing actionable. */
    footer, .site-footer, .footer-links, .copyright-info { display: none !important; }

    /**
     * Advertising.
     *
     * Not removed on principle — it is how the site is funded — but this is a
     * personal client with no browser around it, and the units are sized for a
     * full page: a 728x90 bottom rail and a 400x225 corner video, inside a panel
     * that is 1180px wide by default. "gtad_" is GE Tracker's own prefix and
     * "pw-" is Playwire's, their ad provider.
     */
    [class*="gtad_"], .sticky-sidebar,
    .adBanner, .adLeaderboard, [class*="leaderboard_ad"],
    [class*="pw-tag"], [class*="pw-corner-ad"], [class*="pw-custom-ima"], [id^="pw-"],
    [id^="google_ads_iframe"], iframe[id^="goog_"], ins.adsbygoogle,
    /* Injected at runtime with a timestamped id, so it can only be matched by
       its prefix — a full-width banner above the price chart. */
    [id^="ad_is_"],
    iframe[src*="doubleclick"], iframe[src*="googlesyndication"] {
      display: none !important;
    }
  `,
  allowNavigation: /^https:\/\/(www\.)?ge-tracker\.com\//,
}

export const TOOLS: Record<ToolId, ToolDef> = {
  dps: DPS,
  calculators: CALCULATORS,
  profile: PROFILE,
  getracker: GETRACKER,
}
