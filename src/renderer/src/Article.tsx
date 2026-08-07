/**
 * The article view.
 *
 * The body arrives already sanitized and rewritten by main's transform, so this
 * only has to place it, intercept clicks on `rp://` links, and draw the infobox
 * natively. Everything expensive happened before the HTML crossed the bridge.
 */

import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { Article as ArticleData, Infobox as InfoboxData } from '@shared/ipc'
import { useNav } from './nav'
import { useStore } from './store'
import { usePlayer, markRequirements } from './player'
import {
  formatOneIn,
  normaliseRateCells,
  rarityClass,
  readDropSources,
  sortSources,
  type DropSource,
} from './drops'

/** Cursor dwell before a link is speculatively fetched. */
const HOVER_MS = 150

/**
 * Decode an href fragment without letting a bare `%` take the page down.
 *
 * Wiki headings are used verbatim as anchors, so drop tables link to `#100%` —
 * and `decodeURIComponent('100%')` is a URIError, not a string. Every page with
 * a 100% drop row was one click away from a dead handler.
 */
function decodeFragment(raw: string): string {
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

export function Article({ title, hash }: { title: string; hash?: string }): JSX.Element {
  const [article, setArticle] = useState<ArticleData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  /** Bumped by the refresh control to re-run the fetch with force. */
  const [reloads, setReloads] = useState(0)
  const [variant, setVariant] = useState(0)
  /** Which form of the subject the card is showing — awake or asleep. */
  const [form, setForm] = useState(0)
  /** The footnote under the cursor, when it is too far away to just highlight. */
  const [cite, setCite] = useState<CiteTipState | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const push = useNav((s) => s.push)
  const levels = usePlayer((s) => s.levels)
  /** What drops this item, read out of the page's own sources table. */
  const [sources, setSources] = useState<DropSource[]>([])
  const showDropRates = useStore((s) => s.settings?.dropRateInTitle ?? false)
  const dropOrder = useStore((s) => s.settings?.dropRateOrder ?? 'common')
  const normalise = useStore((s) => s.settings?.normaliseDropRates ?? false)

  useEffect(() => {
    let live = true
    setLoading(true)
    setError(null)
    setArticle(null)

    window.rp
      .getPage(title, { force: reloads > 0 })
      .then((got) => {
        if (!live) return
        if (!got) setError(`No article named “${title}”.`)
        else {
          setArticle(got)
          const first = got.infobox?.defaultForm ?? 0
          setForm(first)
          setVariant(got.infobox?.forms[first]?.defaultVariant ?? 0)
        }
      })
      .catch((err: unknown) => {
        if (live) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (live) setLoading(false)
      })

    return () => {
      live = false
    }
  }, [title, reloads])

  // A fresh title starts from an un-forced fetch again.
  useEffect(() => setReloads(0), [title])

  /**
   * The body HTML, as one object that only changes when the article does.
   *
   * React compares `dangerouslySetInnerHTML` by reference, not by the string
   * inside it — so building `{ __html }` inline in the JSX made every render of
   * this component re-set `innerHTML` and rebuild the entire article DOM. That
   * threw away everything written onto the body after the fact: the met/unmet
   * requirement marks, the citation highlight, and which gear tab was open.
   * Switching an infobox variant was enough to do it.
   */
  const bodyHtml = useMemo(() => ({ __html: article?.html ?? '' }), [article])

  /**
   * Where a new article starts.
   *
   * Top by default — without this the previous scroll position survives the
   * swap and you land mid-page. With a hash, at that section instead, which is
   * how a drop badge opens its source already at the loot table. The lookup has
   * to wait for the article, since the anchor lives in HTML that does not exist
   * until then; an anchor that does not resolve falls back to the top rather
   * than leaving you wherever the last page was.
   */
  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    if (hash && article && bodyRef.current) {
      const target = findAnchor(bodyRef.current, hash)
      if (target) {
        target.scrollIntoView({ block: 'start' })
        return
      }
    }
    scroller.scrollTo(0, 0)
  }, [title, hash, article])

  /**
   * Mark skill requirements against your own levels.
   *
   * Run from the scroller rather than the body, because it has to reach both:
   * the wiki's `.scp` requirement markers appear in the prose and inside the
   * infobox, and the infobox is drawn natively as a sibling of the body. The
   * variant matters too — switching an item's form re-renders those rows.
   *
   * Done here rather than in the transform on purpose. The page cache is shared
   * and keyed by title alone, so an answer baked into the HTML would be one
   * account's answer served to every reader, and wrong the moment you level up.
   */
  useEffect(() => {
    if (!scrollRef.current || !article) return
    markRequirements(scrollRef.current, levels)
  }, [article, variant, levels])

  /**
   * Drop rates: read them out of the body, and optionally restate them.
   *
   * Both run off the rendered DOM rather than anything main computed, so the
   * page cache stays a plain copy of the wiki and both settings take effect the
   * moment they are switched rather than on the next fetch.
   */
  useEffect(() => {
    const root = bodyRef.current
    if (!root || !article) {
      setSources([])
      return
    }
    normaliseRateCells(root, normalise)
    // After normalising, so a badge quotes the same figure as the table.
    setSources(showDropRates ? readDropSources(root) : [])
  }, [article, showDropRates, normalise])

  /**
   * One delegated listener rather than rebinding every anchor.
   *
   * The body holds hundreds of links; attaching handlers to each on every
   * render would cost more than rendering the page.
   */
  useEffect(() => {
    const root = bodyRef.current
    if (!root) return

    const onClick = (e: MouseEvent): void => {
      // Gear-setup tabs, built by the transform out of MediaWiki's Tabber
      // markup. Handled here rather than with per-button listeners because the
      // body is replaced wholesale on every navigation.
      const tab = (e.target as HTMLElement).closest<HTMLElement>('.rp-tab')
      if (tab) {
        const tabber = tab.closest<HTMLElement>('.rp-tabber')
        const index = tab.dataset.tab
        if (tabber && index !== undefined) {
          tabber.dataset.activeTab = index
          for (const b of tabber.querySelectorAll('.rp-tab')) {
            b.classList.toggle('is-active', (b as HTMLElement).dataset.tab === index)
          }
        }
        return
      }

      const anchor = (e.target as HTMLElement).closest('a')
      if (!anchor) return

      const target = anchor.dataset.title
      if (target) {
        e.preventDefault()
        // The transform keeps the fragment on the href but not in `data-title`,
        // so a link into a section of another page used to arrive at its top.
        const fragment = anchor.getAttribute('href')?.split('#')[1]
        push({
          kind: 'page',
          title: target,
          hash: fragment ? decodeFragment(fragment) : undefined,
        })
        return
      }
      // External links are already target=_blank; main's window-open handler
      // sends them to the real browser.
      if (anchor.classList.contains('rp-external')) return

      // In-page anchors: scroll rather than navigate. Covers the contents box
      // as well as the body's own links, since it is rendered inside here.
      const href = anchor.getAttribute('href') ?? ''
      if (href.startsWith('#')) {
        e.preventDefault()
        const id = decodeFragment(href.slice(1))
        root.querySelector(`[id="${CSS.escape(id)}"]`)?.scrollIntoView({ behavior: 'smooth' })
      }
    }

    /**
     * Highlight the note a footnote marker points at, the way the website does.
     *
     * Not expressible in CSS: the marker and its note are unrelated in the tree
     * and joined only by an href fragment, so the target has to be looked up.
     */
    let highlighted: Element | null = null
    const clearHighlight = (): void => {
      highlighted?.classList.remove('rp-cite-target')
      highlighted = null
      setCite(null)
    }
    const highlightCite = (e: MouseEvent): void => {
      const ref = (e.target as HTMLElement).closest<HTMLElement>('.reference a')
      if (!ref) return clearHighlight()
      const id = ref.getAttribute('href')?.slice(1)
      if (!id) return
      const note = root.querySelector(`[id="${CSS.escape(decodeFragment(id))}"]`)
      if (note === highlighted) return
      clearHighlight()
      if (!note) return
      note.classList.add('rp-cite-target')
      highlighted = note

      // Highlighting is only an answer when the note is on screen. On a gear
      // table the markers are in the loadout and the notes are below it, often
      // a screen away — which is the whole complaint: the marker says there is
      // something to know and then nothing happens. Bring the note to the
      // cursor instead, but only when it is not already in view.
      if (isInView(note, scrollRef.current)) return
      setCite({ html: noteHtml(note), anchor: ref.getBoundingClientRect() })
    }

    let timer: number | undefined
    const onOver = (e: MouseEvent): void => {
      highlightCite(e)
      const anchor = (e.target as HTMLElement).closest('a')
      const target = anchor?.dataset.title
      if (!target) return
      window.clearTimeout(timer)
      // Dwell first: sweeping the cursor across a paragraph crosses a dozen
      // links, and prefetching each one would be the opposite of polite.
      timer = window.setTimeout(() => window.rp.prefetchPage(target), HOVER_MS)
    }
    const onOut = (): void => {
      window.clearTimeout(timer)
      clearHighlight()
    }

    root.addEventListener('click', onClick)
    root.addEventListener('mouseover', onOver)
    root.addEventListener('mouseout', onOut)
    return () => {
      window.clearTimeout(timer)
      root.removeEventListener('click', onClick)
      root.removeEventListener('mouseover', onOver)
      root.removeEventListener('mouseout', onOut)
    }
  }, [push, article])

  /** Jump to the sources table on this page — where the badges were read from. */
  const scrollToSources = (): void => {
    const root = bodyRef.current
    if (!root) return
    for (const table of root.querySelectorAll('table')) {
      const headers = [...table.querySelectorAll('th')].map((th) =>
        (th.textContent ?? '').trim().toLowerCase()
      )
      if (headers.includes('source') && headers.includes('rarity')) {
        table.scrollIntoView({ behavior: 'smooth', block: 'center' })
        return
      }
    }
  }

  if (loading) return <div className="placeholder">Loading {title}…</div>
  if (error) {
    return (
      <div className="placeholder">
        <h2>{title}</h2>
        <p>{error}</p>
      </div>
    )
  }
  if (!article) return <div className="placeholder">Nothing to show.</div>

  return (
    <div className="article-scroll" ref={scrollRef}>
      <article className="article selectable">
        <h1 className="article-title">
          {article.title}
          <DropBadges
            sources={sources}
            order={dropOrder}
            // The source's drop section, not just its page. "Drops" is what the
            // wiki heads it on a monster; a source without one lands at the top
            // rather than nowhere, since the scroll falls back.
            onSource={(s) =>
              s.title
                ? push({ kind: 'page', title: s.title, hash: 'Drops' })
                : scrollToSources()
            }
            onAll={scrollToSources}
          />
        </h1>

        <PriceHeader title={article.title} />

        {article.infobox && (
          <Infobox
            box={article.infobox}
            form={form}
            // Each form has its own variants, so switching form has to reset to
            // that form's default rather than carry an index that may not exist.
            onForm={(f) => {
              setForm(f)
              setVariant(article.infobox?.forms[f]?.defaultVariant ?? 0)
            }}
            variant={variant}
            onVariant={setVariant}
          />
        )}

        <div
          className="article-body"
          ref={bodyRef}
          // Body blocks tagged by the transform reveal only the selected
          // variant, so the detail image follows the tabs.
          data-variant={variant}
          // Safe by construction: main strips script, style, event handlers and
          // javascript: URLs before this is ever cached. See wiki/transform.ts.
          dangerouslySetInnerHTML={bodyHtml}
        />

        <Footer article={article} onRefresh={() => setReloads((n) => n + 1)} />
      </article>

      {cite && <CiteTip tip={cite} />}
    </div>
  )
}

/**
 * The infobox, drawn natively.
 *
 * Variants are the interesting part. Many items exist in more than one form —
 * charged and uncharged, active and inactive — and the wiki packs every form's
 * values into the same cells, relying on its own JavaScript to show one at a
 * time. Here they become real tabs, and a row with nothing to say for the
 * selected variant is omitted rather than shown empty.
 */
/**
 * Live price under the title, for anything tradeable.
 *
 * The infobox carries an Exchange row, but it is a static number the wiki
 * rendered whenever the page was last edited. This one is current, and puts the
 * two figures that actually decide a trade — buy and sell — where the eye
 * already is. Renders nothing at all for untradeable pages, which is most of
 * them.
 */
function PriceHeader({ title }: { title: string }): JSX.Element | null {
  const [item, setItem] = useState<{ id: number; name: string } | null>(null)
  const [price, setPrice] = useState<{ high: number | null; low: number | null } | null>(null)
  const push = useNav((s) => s.push)
  const geTrackerPrices = useStore((s) => s.settings?.priceHistoryInGeTracker ?? false)

  useEffect(() => {
    let live = true
    setItem(null)
    setPrice(null)
    void window.rp
      .geFindByName(title)
      .then(async (found) => {
        if (!live || !found) return
        setItem(found)
        const detail = await window.rp.geDetail(found.id)
        if (live && detail?.price) setPrice(detail.price)
      })
      .catch(() => {
        // A page with no tradeable counterpart is the common case, not an error.
      })
    return () => {
      live = false
    }
  }, [title])

  if (!item || !price || (price.high === null && price.low === null)) return null

  return (
    <div className="price-header">
      <span className="price-header-pair">
        <span className="price-header-label">Buy</span>
        <strong>{price.high !== null ? price.high.toLocaleString() : '—'}</strong>
      </span>
      <span className="price-header-pair">
        <span className="price-header-label">Sell</span>
        <strong>{price.low !== null ? price.low.toLocaleString() : '—'}</strong>
      </span>
      {/* Named for the item it resolves to, since a charged weapon's price is
          really its uncharged form's. */}
      <button
        className="btn price-header-btn"
        // Where this goes is a setting: the built-in chart is offline and drawn
        // in the app's theme, GE Tracker has margins and a longer history. The
        // item name rather than the id, because their URLs are keyed by name.
        onClick={() =>
          push(
            geTrackerPrices
              ? { kind: 'tool', id: 'getracker', arg: item.name }
              : { kind: 'ge', itemId: item.id }
          )
        }
      >
        Price history
      </button>
      {item.name !== title && <span className="price-header-note">as {item.name}</span>}
    </div>
  )
}

/**
 * Headings that hold what a thing drops.
 *
 * There is no agreed name for that section. A monster heads it "Drops", a
 * chest "Loot table", a raid "Rewards" — Ancient chest, which is where the
 * twisted bow comes from, uses the second and has no "Drops" heading anywhere.
 */
const LOOT_HEADING = /drop|loot|reward/i

/**
 * The element a fragment refers to.
 *
 * An exact id wins, always — that is what a wiki link means. The fallback only
 * applies when the fragment was itself asking for a loot table and this page
 * calls it something else, which is the case a drop badge has to survive. A
 * link to a section that simply does not exist still resolves to nothing, and
 * the caller sends you to the top rather than somewhere invented.
 */
function findAnchor(root: HTMLElement, hash: string): Element | null {
  const exact = root.querySelector(`[id="${CSS.escape(hash)}"]`)
  if (exact) return exact
  if (!LOOT_HEADING.test(hash)) return null
  for (const heading of root.querySelectorAll('h2, h3')) {
    if (heading.id && LOOT_HEADING.test(heading.id)) return heading
  }
  return null
}

/* ── Drop rates beside the title ─────────────────────────────────────────── */

/** Past this many sources the badges stop being a summary and become a wall. */
const MAX_BADGES = 3

/**
 * An item's drop rates, next to its name.
 *
 * The question "how rare is this" is the reason most item pages get opened, and
 * the answer is otherwise most of a page away in a table you have to scroll to
 * and then do arithmetic on. Each badge carries the odds in 1-in-N form and the
 * rarity colour the wiki would have given it, and opens the loot table it came
 * from — the source's own drop section, not just the source's page.
 *
 * Beyond three sources the badges would say less than the table does, so they
 * collapse to one chip pointing at it.
 */
function DropBadges({
  sources,
  order,
  onSource,
  onAll,
}: {
  sources: DropSource[]
  order: 'common' | 'rare'
  onSource: (source: DropSource) => void
  onAll: () => void
}): JSX.Element | null {
  if (sources.length === 0) return null

  if (sources.length > MAX_BADGES) {
    return (
      <span className="drop-badges">
        <button
          className="drop-badge is-many"
          title={`${sources.length} sources — jump to the table`}
          onClick={onAll}
        >
          Multiple sources
        </button>
      </span>
    )
  }

  return (
    <span className="drop-badges">
      {sortSources(sources, order).map((s, i) => (
        <button
          key={`${s.source}-${i}`}
          className={`drop-badge ${rarityClass(s.rate)}`}
          // The source is the tooltip rather than a label: naming every source
          // inline pushes the title onto a second line on any item with more
          // than one, and the colour plus the odds is the part being scanned.
          title={`${formatOneIn(s.rate)} from ${s.source} — open its drop table`}
          onClick={() => onSource(s)}
        >
          {formatOneIn(s.rate)}
        </button>
      ))}
    </span>
  )
}

/* ── Footnote hover card ─────────────────────────────────────────────────── */

interface CiteTipState {
  html: string
  anchor: DOMRect
}

/** How wide the card may get. The clamp below budgets for exactly this. */
const CITE_TIP_WIDTH = 340
const CITE_TIP_GAP = 10

/**
 * Is the note near enough to the viewport to count as already answered?
 *
 * Measured against the article's own scroller rather than the window: the
 * article scrolls inside `.article-scroll`, so a note 2000px down is still
 * inside the window's coordinate space and only its position relative to that
 * box says whether you can see it. The margin stops a two-pixel sliver at the
 * bottom edge from counting as visible.
 */
function isInView(note: Element, scroller: HTMLElement | null): boolean {
  if (!scroller) return false
  const box = scroller.getBoundingClientRect()
  const rect = note.getBoundingClientRect()
  const margin = 24
  return rect.bottom > box.top + margin && rect.top < box.bottom - margin
}

/**
 * The note's own markup, minus the jump-back arrow.
 *
 * Cloned rather than read in place, because removing the backlink from the live
 * node would break the note for everything else. The HTML came out of the body
 * this component injected, so it has already been through main's sanitizer.
 */
function noteHtml(note: Element): string {
  const clone = note.cloneNode(true) as HTMLElement
  for (const back of clone.querySelectorAll('.mw-cite-backlink')) back.remove()
  return clone.innerHTML.trim()
}

/**
 * Fixed rather than absolute, so the scrolling article cannot clip it, and
 * positioned from the marker's own rectangle. Inert to the pointer: the note
 * may carry links, and a card that swallows clicks on its way to the text
 * underneath is worse than one that cannot be clicked at all.
 */
function CiteTip({ tip }: { tip: CiteTipState }): JSX.Element {
  const { anchor, html } = tip
  const left = Math.max(
    CITE_TIP_GAP,
    Math.min(anchor.left, window.innerWidth - CITE_TIP_WIDTH - CITE_TIP_GAP)
  )
  // Above the marker, unless it is close enough to the top bar that the card
  // would be cut off there.
  const below = anchor.top < 140
  const top = below ? anchor.bottom + CITE_TIP_GAP : anchor.top - CITE_TIP_GAP

  return (
    <div
      className="rp-cite-tip"
      role="tooltip"
      style={{
        left,
        top,
        transform: below ? undefined : 'translateY(-100%)',
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

/** Widest an infobox picture can be and still be a sprite worth upscaling. */
const SPRITE_MAX_PX = 128

/**
 * Is this infobox picture a small item sprite rather than a full render?
 *
 * MediaWiki states the rendered size on the tag itself and the transform leaves
 * those attributes alone (see wiki/transform.ts), so the answer is already in
 * the markup — no need to wait for the image to load and measure it.
 */
function isSprite(html: string): boolean {
  const width = Number(/\bwidth="(\d+)"/.exec(html)?.[1])
  return Number.isFinite(width) && width > 0 && width <= SPRITE_MAX_PX
}

/**
 * The infobox, drawn natively, with up to two rows of tabs.
 *
 * The outer row is *forms* — Vorkath awake and asleep, the Nightmare active and
 * idle. These are separate tables on the wiki, stacked down the page or hidden
 * behind its own tab script, and only ever one of them used to reach the card.
 *
 * The inner row is *variants* within a form: charged and uncharged, post-quest
 * and Dragon Slayer II. The wiki packs every variant's values into the same
 * cells and relies on its script to show one at a time, which is why an item
 * like the Scythe of vitur otherwise reads as both its names mashed together.
 * A row with nothing to say for the selected variant is dropped rather than
 * shown empty.
 */
function Infobox({
  box,
  form,
  onForm,
  variant,
  onVariant,
}: {
  box: InfoboxData
  form: number
  onForm: (f: number) => void
  variant: number
  onVariant: (v: number) => void
}): JSX.Element | null {
  // Optional chaining rather than plain indexing: a migration clears rows
  // written before forms existed, but a card that throws would take the whole
  // article view down with it, and that is not a trade worth one saved `?.`.
  const current = box.forms?.[form] ?? box.forms?.[0]
  if (!current) return null

  const pick = (single: string, per?: Array<string | null>): string | null =>
    per ? per[variant] : single

  const header = current.headerByVariant?.[variant] ?? current.header
  const image = pick(current.image ?? '', current.imageByVariant)

  return (
    <aside className="infobox-card">
      {header && <h2 className="infobox-header">{header}</h2>}

      {box.forms.length > 1 && (
        <div className="infobox-tabs is-forms" role="tablist">
          {box.forms.map((f, i) => (
            <button
              key={f.label}
              role="tab"
              aria-selected={i === form}
              className={`infobox-tab ${i === form ? 'is-active' : ''}`}
              onClick={() => onForm(i)}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {current.variants.length > 1 && (
        <div className="infobox-tabs" role="tablist">
          {current.variants.map((name, i) => (
            <button
              key={name}
              role="tab"
              aria-selected={i === variant}
              className={`infobox-tab ${i === variant ? 'is-active' : ''}`}
              onClick={() => onVariant(i)}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {image && (
        <div
          className="infobox-image"
          // Only a small sprite gets the crisp upscale. See article.css — the
          // scale is a paint-time transform, so applying it to a full-size
          // render pushes the picture outside the card without the layout ever
          // knowing.
          data-sprite={isSprite(image) ? 'true' : 'false'}
          dangerouslySetInnerHTML={{ __html: image }}
        />
      )}

      <dl className="infobox-rows">
        {current.rows.map((row, i) => {
          const value = pick(row.value, row.byVariant)
          if (!value) return null
          // The live Grand Exchange price is the row people scan an item page
          // for; it earns a gold rule rather than sitting in the run of
          // release dates and weights.
          const isPrice = /^exchange$/i.test(row.label.replace(/<[^>]*>/g, '').trim())
          return (
            <div className={`infobox-row ${isPrice ? 'is-price' : ''}`} key={`${row.label}-${i}`}>
              <dt dangerouslySetInnerHTML={{ __html: row.label }} />
              <dd dangerouslySetInnerHTML={{ __html: value }} />
            </div>
          )
        })}
      </dl>
    </aside>
  )
}

/**
 * Attribution, plus cache provenance.
 *
 * The licence line is not decoration: wiki content is CC BY-NC-SA 3.0 and
 * attribution is a condition of using it at all.
 */
function Footer({
  article,
  onRefresh,
}: {
  article: ArticleData
  onRefresh: () => void
}): JSX.Element {
  const url = `https://oldschool.runescape.wiki/w/${encodeURIComponent(article.title.replace(/ /g, '_'))}`

  return (
    <footer className="article-footer">
      {article.categories.length > 0 && (
        <div className="article-categories">
          {article.categories.slice(0, 8).map((c) => (
            <span className="chip" key={c}>
              {c}
            </span>
          ))}
        </div>
      )}
      <p>
        From the{' '}
        <a href={url} target="_blank" rel="noreferrer" className="rp-external">
          Old School RuneScape Wiki
        </a>
        , licensed{' '}
        <a
          href="https://creativecommons.org/licenses/by-nc-sa/3.0/"
          target="_blank"
          rel="noreferrer"
          className="rp-external"
        >
          CC BY-NC-SA 3.0
        </a>
        .{' '}
        {article.stale ? 'This copy is out of date and will refresh.' : null}
      </p>
      <p className="article-meta">
        Cached {new Date(article.fetchedAt).toLocaleString()} · revision {article.revid}
        {' · '}
        <button className="link-btn" onClick={onRefresh}>
          refresh
        </button>
      </p>
    </footer>
  )
}
