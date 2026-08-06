/**
 * MediaWiki HTML -> Rune Panel HTML.
 *
 * This is what separates "a wiki in a window" from a native-feeling reader. It
 * runs once per page in main, before the row is cached, so the renderer only
 * ever receives clean markup and the cost is never paid twice.
 *
 * Five jobs, in order:
 *
 *  1. Sanitize. The output is injected with dangerouslySetInnerHTML, so script,
 *     style, event handlers and javascript: URLs have to be gone. The wiki is
 *     not hostile, but "trusted source" is not a security model.
 *  2. Lift the infobox out into structured data the renderer draws natively.
 *  3. Rewrite links: internal ones to rp:// routes, external ones marked so
 *     they can open in a real browser.
 *  4. Rewrite images to the rpimg:// cache protocol.
 *  5. Strip chrome that only makes sense on the website — navboxes, the
 *     cross-wiki header, parser-cache comments.
 */

import * as cheerio from 'cheerio'
import type { AnyNode, Element } from 'domhandler'

export interface InfoboxRow {
  label: string
  /** Already-transformed HTML: values carry links and item icons worth keeping. */
  value: string
  /**
   * Per-variant values, when the row differs between variants. Parallel to
   * `Infobox.variants`; a missing entry means the row is the same for that one.
   */
  byVariant?: Array<string | null>
}

export interface Infobox {
  /** The bold title row at the top of the box, if present. */
  header?: string
  /** Per-variant titles, when the item is renamed between variants. */
  headerByVariant?: Array<string | null>
  /** Transformed HTML for the main image, if the box has one. */
  image?: string
  imageByVariant?: Array<string | null>
  rows: InfoboxRow[]
  /**
   * Variant names, in order — "Uncharged", "Charged". Empty for the ordinary
   * single-form infobox.
   */
  variants: string[]
  /** Which variant the wiki shows first. */
  defaultVariant: number
}

export interface TransformResult {
  html: string
  infobox: Infobox | null
}

/**
 * Elements that exist for the website and mean nothing here.
 *
 * `.navbox` is the big link table at the foot of every page — 52 references on
 * the whip article alone, and entirely redundant when search is a keystroke
 * away. `.rs-external-header-links` is the cross-wiki switcher. `.mw-editsection`
 * and `#toc` are replaced by our own affordances.
 */
const STRIP = [
  '.navbox',
  '.navbox-styles',
  '.rs-external-header-links',
  '.mw-editsection',
  '.catlinks',
  '#toc',
  '.toc',
  '.mw-jump-link',
  '.noprint',

  // Hidden data payloads. `.infobox-switch-resources` is a dump of every
  // variant's raw field values that the wiki's JavaScript reads to populate the
  // switch; its own stylesheet hides it with `.hidden`, and since we strip
  // stylesheets it would otherwise render as a wall of "Scythe of vitur
  // (uncharged)Scythe of vitur? (edit) UnchargedChargedfalsetrue" above the
  // article. Anything else marked `.hidden` is hidden for the same reason.
  '.infobox-switch-resources',
  '.hidden',
  '.navigation-not-searchable.hidden',

  // The wiki's own Grand Exchange chart. Inert here — its scripts never run, so
  // it renders as "Loading..." forever above an empty box — and redundant,
  // since this app draws price history from the same feed itself.
  '.GEChartBox',
  '.GEdatachart',
  '.GEdataprices',
  '.GEChartItems',

  'style',
  'script',
  'link',
  'meta',
]

/** Namespaces that are not readable articles, so their links get de-linked. */
const NON_ARTICLE_NS = /^(File|Image|Media|Category|Template|Help|Special|Module|MediaWiki):/i

export function transform(html: string, pageTitle: string): TransformResult {
  const $ = cheerio.load(html, null, false)

  // 0 ── harvest the switch payload before the strip below removes it. The
  //      rendered table only ever contains the first variant's values; every
  //      other variant lives in this hidden block, which is the only place to
  //      get them.
  const switchData = harvestSwitchResources($)

  // 1 ── sanitize
  $(STRIP.join(',')).remove()
  $('*').each((_, el) => {
    const attribs = (el as Element).attribs ?? {}
    for (const name of Object.keys(attribs)) {
      // Inline handlers, and anything that could execute through a URL.
      if (name.toLowerCase().startsWith('on')) $(el).removeAttr(name)
    }
    for (const urlAttr of ['href', 'src', 'action', 'formaction']) {
      const value = attribs[urlAttr]
      if (value && /^\s*(javascript|data|vbscript):/i.test(value)) $(el).removeAttr(urlAttr)
    }
  })
  // Comments carry the parser-cache dump — kilobytes of nothing, on every page.
  $('*')
    .contents()
    .filter((_, node) => node.type === 'comment')
    .remove()

  // 2 ── rewrite links and images before the infobox is lifted, so its values
  //      come out already transformed rather than needing a second pass.
  rewriteLinks($, pageTitle)
  rewriteImages($)

  // 3 ── lift the infobox
  const infobox = extractInfobox($, switchData)

  // 4 ── tag tables so the stylesheet can make them scroll and stripe
  $('table.wikitable').addClass('rp-table')

  // 5 ── body content that follows the infobox tabs
  markSyncedSwitches($)

  // The variant buttons are drawn natively on the infobox card, so the copies
  // the wiki puts on every in-body switch table are duplicates.
  $('.infobox-switch-buttons-caption, .infobox-buttons').remove()

  // Unwrap the outer parser div; the renderer supplies its own container.
  const root = $('.mw-parser-output')
  const out = root.length ? root.html() : $.html()

  return { html: (out ?? '').trim(), infobox }
}

/**
 * `/w/Title` becomes `rp://page/Title`; everything else is marked external.
 *
 * Anchors within the page are left alone so the table of contents and citation
 * jumps keep working. Links into File:, Category: and friends are unwrapped
 * rather than rewritten — they resolve to pages this app has no renderer for,
 * and a link that goes nowhere is worse than plain text.
 */
function rewriteLinks($: cheerio.CheerioAPI, pageTitle: string): void {
  $('a[href]').each((_, el) => {
    const $a = $(el)
    const href = $a.attr('href') ?? ''

    if (href.startsWith('#')) return

    const internal = /^\/w\/(.+)$/.exec(href)
    if (internal) {
      const raw = decodeURIComponent(internal[1].split('#')[0].replace(/_/g, ' '))
      const fragment = internal[1].includes('#') ? '#' + internal[1].split('#')[1] : ''

      if (NON_ARTICLE_NS.test(raw)) {
        // Keep the text and any image inside, drop the dead link.
        $a.replaceWith($a.contents())
        return
      }
      // A self-link is already where you are.
      if (raw === pageTitle) {
        $a.replaceWith($a.contents())
        return
      }

      $a.attr('href', `rp://page/${encodeURIComponent(raw)}${fragment}`)
      $a.attr('data-title', raw)
      $a.addClass('rp-link')
      $a.removeAttr('title')
      return
    }

    // Protocol-relative and absolute URLs both leave the app.
    if (/^(https?:)?\/\//.test(href)) {
      $a.attr('href', href.startsWith('//') ? `https:${href}` : href)
      $a.addClass('rp-external')
      $a.attr('target', '_blank')
      $a.attr('rel', 'noreferrer')
      return
    }

    // Anything else — relative paths we do not understand — loses its link.
    $a.replaceWith($a.contents())
  })
}

/**
 * `/images/Name.png?hash` becomes `rpimg://img/Name.png`.
 *
 * Two details that each cost a bug to find.
 *
 * The constant `img` host is load-bearing. `rpimg` is registered as a
 * `standard` scheme, so `rpimg://thumb/X.png/130px-X.png` parses with `thumb`
 * as the *host* — which Chromium then lowercases, and which the path loses
 * entirely. Pinning a dummy host keeps the whole filename, thumbnail
 * subdirectories and all, inside the pathname where case is preserved.
 *
 * The cache-busting query is dropped deliberately: it changes whenever the file
 * is re-uploaded, and keying the local cache on it would re-download every icon
 * on every edit. Freshness of a decade-old item sprite is not worth that.
 */
function rewriteImages($: cheerio.CheerioAPI): void {
  $('img[src]').each((_, el) => {
    const $img = $(el)
    const src = $img.attr('src') ?? ''
    const match = /^(?:https?:)?(?:\/\/oldschool\.runescape\.wiki)?\/images\/([^?#]+)/.exec(src)
    if (!match) {
      // Off-wiki image, or a shape we do not recognise: drop it rather than
      // leave a request the CSP will block anyway.
      $img.remove()
      return
    }
    $img.attr('src', `rpimg://img/${match[1]}`)
    $img.attr('loading', 'lazy')
    // srcset points at the same origin in other sizes; the cache serves one.
    $img.removeAttr('srcset')
    $img.removeAttr('decoding')
  })

  // Weapon and spell sound effects. They cannot play: the renderer's CSP has no
  // media source, and the asset protocol serves images only. A dead player
  // control is worse than no control, so they go. Supporting them properly is a
  // small, separate change — a media protocol plus a `media-src` allowance.
  $('audio, video').remove()

  // Chart.js payloads. On the website MediaWiki's JS reads this <pre>, which
  // holds a chart's configuration as JSON, and replaces it with a canvas.
  // Without that script it renders as raw JSON on a single unwrapped line —
  // measured at 626,588px wide on the Twisted bow page, which drags a
  // horizontal scrollbar across the whole article. These are almost all Grand
  // Exchange price history, which this app draws natively instead.
  $('.rsw-chartjs, .rsw-chartjs-config, .chartjs-config').remove()
}

/**
 * Pull the infobox out of the flow and into structured rows.
 *
 * This is most of what makes the page feel like ours rather than a reskin: the
 * renderer draws it as a native panel instead of an HTML table pretending to be
 * one. Values keep their HTML — a release date is two links, an equipment slot
 * is an icon — so only the layout is replaced, never the content.
 */
/**
 * Values for every variant, pulled out of the hidden switch payload.
 *
 * Keyed by the payload's own resource class, then by field name, then by
 * variant index, exactly as the markup numbers them.
 *
 * Index 0 is not a variant: it is the value shared by any variant that has no
 * entry of its own. The Scythe's `name` field, for instance, lists only index 0
 * ("Scythe of vitur (uncharged)") and index 2 ("Scythe of vitur") — variant 1
 * inherits index 0. Where a field is genuinely unset the wiki puts a "? (edit)"
 * link there instead, which `isUnset` recognises and refuses to inherit.
 */
type SwitchData = Map<string, Map<string, Map<number, string>>>

function harvestSwitchResources($: cheerio.CheerioAPI): SwitchData {
  const data: SwitchData = new Map()

  $('.infobox-switch-resources').each((_, block) => {
    const $block = $(block)
    // The class that ties this payload to its table, e.g.
    // "infobox-resources-Infobox_Item".
    const key =
      ($block.attr('class') ?? '')
        .split(/\s+/)
        .find((c) => c.startsWith('infobox-resources-')) ?? ''
    if (!key) return

    const fields = new Map<string, Map<number, string>>()
    $block.children('[data-attr-param]').each((_, el) => {
      const param = $(el).attr('data-attr-param')
      if (!param) return
      const byIndex = new Map<number, string>()
      $(el)
        .children('[data-attr-index]')
        .each((_, span) => {
          const idx = Number($(span).attr('data-attr-index'))
          if (!Number.isFinite(idx) || idx < 0) return
          byIndex.set(idx, ($(span).html() ?? '').trim())
        })
      if (byIndex.size) fields.set(param, byIndex)
    })

    if (fields.size) data.set(key, fields)
  })

  return data
}

function extractInfobox($: cheerio.CheerioAPI, switchData: SwitchData): Infobox | null {
  const table = $('table.infobox').first()
  if (table.length === 0) return null

  // Variant tabs. The wiki renders these as buttons in the table's <caption>
  // and relies on its own JavaScript to switch them; without that script every
  // variant's value renders at once, which is why an item like the Scythe of
  // vitur reads as "Scythe of vitur (uncharged)Scythe of vitur" mashed together.
  const buttons = table.find('.infobox-buttons [data-switch-index]')
  const variants = buttons
    .toArray()
    .map((el) => $(el).text().trim())
    .filter(Boolean)

  const declaredDefault = Number(table.find('.infobox-buttons').attr('data-default-version'))
  const box: Infobox = {
    rows: [],
    variants,
    // The attribute is 1-based and may be absent or out of range.
    defaultVariant:
      Number.isFinite(declaredDefault) && declaredDefault >= 1 && declaredDefault <= variants.length
        ? declaredDefault - 1
        : 0,
  }

  /**
   * Split a cell into its per-variant values.
   *
   * A switched cell holds one `<span data-attr-index="N">` per variant; an
   * unswitched one holds plain content that applies to all of them. Returns
   * null for the unswitched case so the caller can keep a single value rather
   * than storing the same HTML N times.
   */
  // Which payload block belongs to this table.
  const resourceKey = (table.attr('data-resource-class') ?? '').replace(/^\./, '')
  const fields = switchData.get(resourceKey)

  const split = (cell: cheerio.Cheerio<Element>): Array<string | null> | null => {
    if (variants.length === 0) return null

    // Inline spans first — some cells carry every variant directly.
    const spans = cell.find('[data-attr-index]')
    if (spans.length > 0) {
      const out: Array<string | null> = new Array(variants.length).fill(null)
      spans.each((_, el) => {
        const idx = Number($(el).attr('data-attr-index')) - 1
        if (idx >= 0 && idx < variants.length) out[idx] = ($(el).html() ?? '').trim()
      })
      return out
    }

    // Otherwise the payload, joined on the field name the cell declares.
    const param = cell.attr('data-attr-param')
    const byIndex = param ? fields?.get(param) : undefined
    if (!byIndex) return null

    const shared = byIndex.get(0)
    const fallback = shared && !isUnset(shared) ? shared : null

    const out: Array<string | null> = new Array(variants.length).fill(fallback)
    for (const [idx, html] of byIndex) {
      if (idx >= 1 && idx - 1 < variants.length) out[idx - 1] = isUnset(html) ? null : html
    }
    return out.some((v) => v !== null) ? out : null
  }

  table.find('tr').each((_, tr) => {
    const $tr = $(tr)

    const header = $tr.find('.infobox-header').first()
    if (header.length) {
      if (box.header === undefined) {
        box.header = header.text().trim()
        const per = split(header)
        if (per) {
          box.headerByVariant = per.map((v) => (v === null ? null : stripTags(v)))
          // With variants the plain text is every name concatenated; the first
          // real per-variant name is a better single fallback.
          box.header = box.headerByVariant.find((v): v is string => !!v) ?? box.header
        }
      }
      return
    }

    const image = $tr.find('.infobox-image').first()
    if (image.length) {
      if (box.image === undefined) {
        box.image = image.html()?.trim() || undefined
        const per = split(image)
        if (per) box.imageByVariant = per
      }
      return
    }

    // Spacer rows and nested layout tables carry no label/value pair.
    const th = $tr.children('th').first()
    const td = $tr.children('td').first()
    if (th.length === 0 || td.length === 0) return

    const label = th.text().trim()
    const value = (td.html() ?? '').trim()
    if (!label || !value) return

    const per = split(td)
    box.rows.push(per ? { label, value, byVariant: per } : { label, value })
  })

  table.remove()

  // A box with no header, no image and no rows is not worth a panel.
  return box.rows.length > 0 || box.image ? box : null
}

/**
 * Body blocks that switch along with the infobox tabs.
 *
 * The wiki's `.rsw-synced-switch` holds one child per variant — usually the
 * large detail image — and marks the visible one with `.showing`. That class is
 * static in the HTML, so without its JavaScript the block is frozen on whichever
 * variant the page was cached with.
 *
 * Rather than freeze it, each item is tagged with a zero-based variant index and
 * the renderer reveals the matching one with CSS. Selecting "Charged" then
 * changes the picture as well as the numbers.
 */
function markSyncedSwitches($: cheerio.CheerioAPI): void {
  $('.rsw-synced-switch').each((_, group) => {
    const items = $(group).children('.rsw-synced-switch-item')
    items.each((_, el) => {
      const $el = $(el)
      // `data-item` is 1-based, and index 0 shows up as an empty placeholder.
      const raw = Number($el.attr('data-item'))
      const index = Number.isFinite(raw) && raw >= 1 ? raw - 1 : -1
      if (index < 0 || $el.html()?.trim() === '') {
        $el.remove()
        return
      }
      $el.attr('data-variant', String(index))
      // The wiki's own visibility class would fight the CSS below.
      $el.removeClass('showing')
    })
    $(group).addClass('rp-synced')
  })
}

/**
 * The wiki's marker for a field nobody has filled in: a bold "?" linking to the
 * edit form. Inheriting it would print a question mark where a value belongs.
 */
function isUnset(html: string): boolean {
  return /action=edit/.test(html) && /<b>\s*\?\s*<\/b>/.test(html)
}

/** Text content of an HTML fragment, for places that must not carry markup. */
function stripTags(html: string): string {
  return cheerio.load(html, null, false).text().trim()
}

/** Plain-text lead paragraph, for search result previews later. */
export function leadText(html: string, maxLength = 280): string {
  const $ = cheerio.load(html, null, false)
  const paragraphs = $('p')
    .toArray()
    .map((p: AnyNode) => $(p).text().trim())
    .filter((t) => t.length > 40)

  const lead = paragraphs[0] ?? ''
  return lead.length > maxLength ? lead.slice(0, maxLength).trimEnd() + '…' : lead
}
