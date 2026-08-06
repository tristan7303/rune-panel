/**
 * MediaWiki HTML -> Rune Buddy HTML.
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
 *  3. Rewrite links: internal ones to rb:// routes, external ones marked so
 *     they can open in a real browser.
 *  4. Rewrite images to the rbimg:// cache protocol.
 *  5. Strip chrome that only makes sense on the website — navboxes, the
 *     cross-wiki header, parser-cache comments.
 */

import * as cheerio from 'cheerio'
import type { AnyNode, Element } from 'domhandler'

export interface InfoboxRow {
  label: string
  /** Already-transformed HTML: values carry links and item icons worth keeping. */
  value: string
}

export interface Infobox {
  /** The bold title row at the top of the box, if present. */
  header?: string
  /** Transformed HTML for the main image, if the box has one. */
  image?: string
  rows: InfoboxRow[]
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
  'style',
  'script',
  'link',
  'meta',
]

/** Namespaces that are not readable articles, so their links get de-linked. */
const NON_ARTICLE_NS = /^(File|Image|Media|Category|Template|Help|Special|Module|MediaWiki):/i

export function transform(html: string, pageTitle: string): TransformResult {
  const $ = cheerio.load(html, null, false)

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
  const infobox = extractInfobox($)

  // 4 ── tag tables so the stylesheet can make them scroll and stripe
  $('table.wikitable').addClass('rb-table')

  // Unwrap the outer parser div; the renderer supplies its own container.
  const root = $('.mw-parser-output')
  const out = root.length ? root.html() : $.html()

  return { html: (out ?? '').trim(), infobox }
}

/**
 * `/w/Title` becomes `rb://page/Title`; everything else is marked external.
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

      $a.attr('href', `rb://page/${encodeURIComponent(raw)}${fragment}`)
      $a.attr('data-title', raw)
      $a.addClass('rb-link')
      $a.removeAttr('title')
      return
    }

    // Protocol-relative and absolute URLs both leave the app.
    if (/^(https?:)?\/\//.test(href)) {
      $a.attr('href', href.startsWith('//') ? `https:${href}` : href)
      $a.addClass('rb-external')
      $a.attr('target', '_blank')
      $a.attr('rel', 'noreferrer')
      return
    }

    // Anything else — relative paths we do not understand — loses its link.
    $a.replaceWith($a.contents())
  })
}

/**
 * `/images/Name.png?hash` becomes `rbimg://img/Name.png`.
 *
 * Two details that each cost a bug to find.
 *
 * The constant `img` host is load-bearing. `rbimg` is registered as a
 * `standard` scheme, so `rbimg://thumb/X.png/130px-X.png` parses with `thumb`
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
    $img.attr('src', `rbimg://img/${match[1]}`)
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
}

/**
 * Pull the infobox out of the flow and into structured rows.
 *
 * This is most of what makes the page feel like ours rather than a reskin: the
 * renderer draws it as a native panel instead of an HTML table pretending to be
 * one. Values keep their HTML — a release date is two links, an equipment slot
 * is an icon — so only the layout is replaced, never the content.
 */
function extractInfobox($: cheerio.CheerioAPI): Infobox | null {
  const table = $('table.infobox').first()
  if (table.length === 0) return null

  const box: Infobox = { rows: [] }

  table.find('tr').each((_, tr) => {
    const $tr = $(tr)

    const header = $tr.find('.infobox-header').first()
    if (header.length) {
      box.header ??= header.text().trim()
      return
    }

    const image = $tr.find('.infobox-image').first()
    if (image.length) {
      box.image ??= image.html()?.trim() || undefined
      return
    }

    // Spacer rows and nested layout tables carry no label/value pair.
    const th = $tr.children('th').first()
    const td = $tr.children('td').first()
    if (th.length === 0 || td.length === 0) return

    const label = th.text().trim()
    const value = (td.html() ?? '').trim()
    if (!label || !value) return

    box.rows.push({ label, value })
  })

  table.remove()

  // A box with no header, no image and no rows is not worth a panel.
  return box.rows.length > 0 || box.image ? box : null
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
