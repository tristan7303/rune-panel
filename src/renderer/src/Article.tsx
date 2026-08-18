/**
 * The article view.
 *
 * The body arrives already sanitized and rewritten by main's transform, so this
 * only has to place it, intercept clicks on `rp://` links, and draw the infobox
 * natively. Everything expensive happened before the HTML crossed the bridge.
 */

import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type {
  Article as ArticleData,
  Infobox as InfoboxData,
  InfoboxMap as InfoboxMapData,
} from '@shared/ipc'
import { useNav, useRoute, rememberScroll, recallScroll } from './nav'
import { useStore } from './store'
import { WorldMap } from './WorldMap'
import { ExpandIcon, PinIcon, PIN_SVG } from './icons'
import { usePins, isPagePinned, isSectionPinned, QD_PREFIX } from './pins'
import {
  usePlayer,
  markRequirements,
  abbreviateRequirementTags,
  pruneMetRequirements,
} from './player'
import { useProfile, markQuests, markCaTasks } from './runeprofile'
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
  /** The history entry this view is showing — the key scroll memory hangs on. */
  const route = useRoute()
  const levels = usePlayer((s) => s.levels)
  const questStates = useProfile((s) => s.questStates)
  const caCompleted = useProfile((s) => s.caCompleted)
  const caCompletedNames = useProfile((s) => s.caCompletedNames)
  /** What drops this item, read out of the page's own sources table. */
  const [sources, setSources] = useState<DropSource[]>([])
  const showDropRates = useStore((s) => s.settings?.dropRateInTitle ?? false)
  const dropOrder = useStore((s) => s.settings?.dropRateOrder ?? 'common')
  const normalise = useStore((s) => s.settings?.normaliseDropRates ?? false)
  const showAlch = useStore((s) => s.settings?.showHighAlchInDrops ?? false)
  /** Whether a jump within this page travels or arrives. */
  const glide = useStore((s) => s.settings?.smoothSectionJumps ?? true)
  const hideMet = useStore((s) => s.settings?.hideMetRequirements ?? false)
  const pinContents = useStore((s) => s.settings?.pinContents ?? false)

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
   *
   * A history entry being *returned to* — Back, Forward — is the exception:
   * it remembers where it was scrolled, and that memory outranks both the top
   * and the hash, because re-running the hash jump would discard wherever the
   * reader had moved on to since.
   */
  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    const remembered = article ? recallScroll(route) : undefined
    if (remembered !== undefined) {
      restoreScroll(scroller, remembered)
    } else {
      const target = hash && article && bodyRef.current ? findAnchor(bodyRef.current, hash) : null
      if (target) {
        scrollToAnchor(scroller, target)
      } else {
        cancelSettle?.()
        scroller.scrollTo(0, 0)
      }
    }
    // Leaving the page abandons any jump still correcting itself, so a late
    // image on the article you have left cannot yank the one you are on.
    return () => cancelSettle?.()
  }, [title, hash, article, route])

  /**
   * Remember where this entry is scrolled, for Back and Forward.
   *
   * Written on every scroll rather than captured on the way out, because by
   * the time this view is being torn down the next route has already rendered
   * and there is no reliable "just before leaving" moment left. Straight into
   * a WeakMap — no state, no re-renders, nothing to throttle.
   */
  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller || !article) return
    const save = (): void => rememberScroll(route, scroller.scrollTop)
    scroller.addEventListener('scroll', save, { passive: true })
    return () => scroller.removeEventListener('scroll', save)
  }, [route, article])

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
    abbreviateRequirementTags(scrollRef.current)
    markRequirements(scrollRef.current, levels)
  }, [article, variant, levels])

  /**
   * Mark quest and combat-achievement progress, from RuneProfile.
   *
   * Same shape as the skill pass above and for the same reasons: run from the
   * scroller so the native infobox is reached, re-run on variant switches, and
   * never bake the answer into the shared page cache. Additive classes only —
   * the memoised body HTML must not be re-set.
   */
  useEffect(() => {
    if (!scrollRef.current || !article) return
    markQuests(scrollRef.current, questStates)
    markCaTasks(scrollRef.current, caCompleted, caCompletedNames)
  }, [article, variant, questStates, caCompleted, caCompletedNames])

  /**
   * Hide the requirements you already meet, when asked to.
   *
   * Declared after the two marking passes because it reads the classes they
   * write — React runs effects in order, which is the whole of the sequencing
   * this needs. Depends on everything they depend on, so any change that moves
   * a mark re-judges what is hidden.
   */
  useEffect(() => {
    if (!scrollRef.current || !article) return
    pruneMetRequirements(scrollRef.current, hideMet)
  }, [article, variant, levels, questStates, caCompleted, caCompletedNames, hideMet])

  /**
   * Offer a pin on every section heading, and on quest-details rows.
   *
   * Injected into the wiki HTML after render — the same additive-only
   * discipline as the marking passes, and safe for the same reason: the
   * memoised body means React never re-sets the markup under it. Rows get pins
   * too because "Requirements" on a quest page is a row of the details table,
   * not a heading, and it is the single most pinnable thing here.
   *
   * Clicks are handled by the delegated listener below rather than per-button
   * handlers, since the body is replaced wholesale on navigation.
   */
  useEffect(() => {
    const root = bodyRef.current
    if (!root || !article) return

    const make = (anchor: string, line: string): HTMLButtonElement => {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'rp-pin-btn'
      btn.dataset.pinAnchor = anchor
      btn.dataset.pinLine = line
      // A static string of our own authorship — see PIN_SVG in icons.tsx.
      btn.innerHTML = PIN_SVG
      return btn
    }

    for (const div of root.querySelectorAll('.mw-heading')) {
      const h = div.querySelector<HTMLElement>('h2, h3, h4, h5')
      if (!h?.id || h.querySelector('.rp-pin-btn')) continue
      h.appendChild(make(h.id, h.textContent?.trim() ?? h.id))
    }
    for (const th of root.querySelectorAll<HTMLElement>(
      'table.questdetails th.questdetails-header'
    )) {
      if (th.querySelector('.rp-pin-btn')) continue
      const text = th.textContent?.trim()
      if (text) th.appendChild(make(`${QD_PREFIX}${text}`, text))
    }
  }, [article])

  /**
   * Keep every pin's filled/hollow state true to the store.
   *
   * Declared after the injection effect so the first pass finds the buttons it
   * just placed; re-runs whenever the pins change, from either end — a section
   * unpinned in the Pinned view goes hollow here without a reload.
   */
  const pins = usePins((s) => s.pages)
  useEffect(() => {
    const root = bodyRef.current
    if (!root || !article) return
    for (const btn of root.querySelectorAll<HTMLElement>('.rp-pin-btn')) {
      const anchor = btn.dataset.pinAnchor
      if (!anchor) continue
      const pinned = isSectionPinned(pins, article.title, anchor)
      btn.classList.toggle('is-pinned', pinned)
      btn.title = pinned ? 'Unpin this section' : 'Pin this section'
    }
  }, [article, pins])

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
      // Section pins, injected above. Toggled through the store's own state
      // rather than the button's class, so a double-fire cannot desync them.
      const pin = (e.target as HTMLElement).closest<HTMLElement>('.rp-pin-btn')
      if (pin) {
        if (article) {
          const anchor = pin.dataset.pinAnchor ?? ''
          const line = pin.dataset.pinLine ?? anchor
          const store = usePins.getState()
          if (isSectionPinned(store.pages, article.title, anchor)) {
            store.unpinSection(article.title, anchor)
          } else {
            store.pinSection(article.title, anchor, line)
          }
        }
        return
      }

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
        const section = root.querySelector(`[id="${CSS.escape(id)}"]`)
        if (section && scrollRef.current) {
          scrollToAnchor(scrollRef.current, section, { smooth: glide })
        }
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
  }, [push, article, glide])

  /** Jump to the sources table on this page — where the badges were read from. */
  const scrollToSources = (): void => {
    const root = bodyRef.current
    const scroller = scrollRef.current
    if (!root || !scroller) return
    for (const table of root.querySelectorAll('table')) {
      const headers = [...table.querySelectorAll('th')].map((th) =>
        (th.textContent ?? '').trim().toLowerCase()
      )
      if (headers.includes('source') && headers.includes('rarity')) {
        scrollToAnchor(scroller, table, { smooth: glide, center: true })
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
    // The class is the setting; whether it does anything is the stylesheet's
    // call — a media query keeps the box inline when the window is too narrow
    // to give up a column, so resizing moves it live with no script involved.
    <div className={`article-scroll ${pinContents ? 'rp-toc-pinned' : ''}`} ref={scrollRef}>
      <article className="article selectable">
        <h1 className="article-title">
          {article.title}
          <PagePin title={article.title} />
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

        {article.infobox && (
          <Infobox
            box={article.infobox}
            subject={article.title}
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
          // The High Alch column is hidden with a class rather than by touching
          // the cells, because the wiki puts `alch-column` on the header as well
          // as every cell under it — so one rule takes the whole column out of
          // the table, and toggling the setting is a class change rather than a
          // pass over hundreds of rows.
          className={`article-body ${showAlch ? '' : 'rp-hide-alch'}`}
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
 * The wiki's "(info)" link inside an Exchange row's value, and the tradeable
 * form it names. That name is the item the price actually belongs to — a
 * charged weapon's Exchange row quotes its uncharged form.
 */
const INFO_LINK = /\s*\(<a\b[^>]*\bdata-title="Exchange:([^"]+)"[^>]*>info<\/a>\)/

/**
 * The Exchange row's value, with the "(info)" link replaced by a View button.
 *
 * The link went to the wiki's `Exchange:` page — a worse copy of the price
 * history this app already draws. The button goes to the reader's chosen price
 * view instead: the built-in chart is offline and drawn in the app's theme, GE
 * Tracker has margins and a longer history. A variant that is not sold has no
 * link and gets no button.
 */
function ExchangeCell({ html }: { html: string }): JSX.Element {
  const push = useNav((s) => s.push)
  const geTrackerPrices = useStore((s) => s.settings?.geTrackerReplacesGe ?? true)

  // The only entity cheerio escapes that plausibly appears in an item name.
  const item = INFO_LINK.exec(html)?.[1]?.replace(/&amp;/g, '&')
  // Memoised for the same reason as the body: a fresh `{ __html }` every
  // render would re-set the cell and shed anything written onto it after.
  const value = useMemo(
    () => ({ __html: item ? html.replace(INFO_LINK, '') : html }),
    [html, item]
  )

  const view = (): void => {
    if (!item) return
    // GE Tracker is keyed by name; the built-in chart wants the item id, which
    // only main's item index can answer.
    if (geTrackerPrices) push({ kind: 'tool', id: 'getracker', arg: item })
    else
      void window.rp
        .geFindByName(item)
        .then((found) => push(found ? { kind: 'ge', itemId: found.id } : { kind: 'ge' }))
  }

  return (
    <dd>
      <span dangerouslySetInnerHTML={value} />
      {item && (
        <button className="infobox-price-view" title={`Price history for ${item}`} onClick={view}>
          View
        </button>
      )}
    </dd>
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

/* ── Anchored jumps ──────────────────────────────────────────────────────── */

/**
 * How long the article must hold its height before a jump lets go.
 *
 * The page's own shape is the signal, rather than a timer or a count of images
 * still in flight. `HTMLImageElement.complete` cannot answer that question: it
 * reads `true` for a lazily-loaded image that has not begun to fetch, so on God
 * Wars Dungeon all 244 pictures above the target claim to be finished at the
 * moment the jump starts. A height that has not moved for this long has not
 * moved because nothing is left to arrive.
 */
const QUIET_MS = 800

/**
 * The longest a jump will hold on regardless.
 *
 * A wiki image the app has not seen before is fetched from the wiki rather than
 * read from disk, and on a page this size there are a couple of hundred of them
 * behind an eight-at-a-time queue; measured with the cache deliberately
 * emptied, the last of them lands a little past three seconds. This is only the
 * backstop for a page that never stops moving at all.
 */
const MAX_SETTLE_MS = 8000

/** Under a pixel is rounding, not a misplaced anchor. */
const SETTLE_SLOP = 1

/**
 * Fraction of the remaining distance covered per frame while gliding.
 *
 * An exponential approach rather than a timed curve, because the destination
 * moves: a tween has to commit to where the target was when it started, which
 * is the very assumption that put the old jump 1,950px above Saradomin's
 * general. This re-aims every frame instead, so a section that shifts mid-glide
 * is simply flown to. 0.18 a frame clears 97% of the gap in about 300ms and the
 * rest shortly after, and a shift that lands once you are already there is
 * taken up over a handful of frames rather than snapping.
 */
const GLIDE = 0.18

/** The frame the glide rate is quoted against; real frames are scaled to it. */
const FRAME_MS = 1000 / 60

/** A frame this late means the tab stalled, not that time really passed. */
const MAX_FRAME_MS = 50

/**
 * The smallest move worth writing, in device pixels.
 *
 * A scroll offset snaps to the device pixel grid — at a 1.3125 ratio that is
 * one CSS pixel in every 0.76 — so a step smaller than the grid
 * is not a small movement, it is no movement. An exponential approach produces
 * ever smaller steps by definition, which is how the glide came to stop dead
 * eleven pixels above its heading and stay there. Below this the remaining
 * distance is crossed at a flat rate instead, which closes it in a few frames
 * and cannot stall.
 */
const MIN_STEP_DP = 2

/** Anything here means the reader has taken the scroll back. */
const TAKEOVER = ['wheel', 'touchstart', 'pointerdown'] as const

/**
 * The jump still correcting itself, if any. Module-scoped because only one
 * article is on screen at a time, and a second jump must supersede the first
 * rather than argue with it.
 */
let cancelSettle: (() => void) | null = null

interface AnchorOptions {
  smooth?: boolean
  /** Put the target mid-screen rather than at the top — for a whole table. */
  center?: boolean
}

/**
 * Jump to an element, and hold it there until the page stops moving.
 *
 * A wiki article is not yet the height it will be. Images arrive over the
 * `rpimg://` cache — from disk when it is warm, from the wiki when it is not —
 * and until the bytes land an image occupies *nothing*, because the stylesheet
 * overrides the width and height MediaWiki writes on every tag (see the image
 * caps in article.css, which need `width: auto` to clamp proportionally). Every
 * picture that resolves above the target therefore adds its height after the
 * jump has already been made, and the section slides down out from under you.
 * Smooth scrolling compounds it: travelling the page is itself what wakes the
 * lazy images along the route, so they land mid-animation. On God Wars Dungeon
 * that is the difference between arriving at Saradomin's general and stopping a
 * couple of screens above him.
 *
 * So rather than guess the final layout, the jump is held: every frame the
 * target is measured again and the scroller moved by what is left, until it
 * stops drifting or the deadline passes. Real scroll input cancels the whole
 * thing — a correction that fights the reader is worse than one that never
 * happened.
 *
 * The glide is ours rather than `behavior: 'smooth'` for the same reason. A
 * native smooth scroll animates toward a fixed offset chosen when it starts, so
 * every image that lands on the way leaves it short — and there is no way to
 * correct it mid-flight, because writing `scrollTop` cancels it outright. Which
 * is exactly what an earlier version of this did: the correction fired two
 * frames in, before the animation had even begun to move, and the glide was
 * lost.
 */
function scrollToAnchor(
  scroller: HTMLElement,
  target: Element,
  { smooth = false, center = false }: AnchorOptions = {}
): void {
  cancelSettle?.()

  // The images between the top of the article and the target are the ones whose
  // late arrival pushes it down, so ask for them now rather than whenever the
  // scroll happens to pass them. They would have been fetched on the way
  // regardless; this only brings the cost inside the window where it can still
  // be corrected for.
  for (const img of scroller.querySelectorAll<HTMLImageElement>('img[loading="lazy"]')) {
    if (target.compareDocumentPosition(img) & Node.DOCUMENT_POSITION_PRECEDING) {
      img.loading = 'eager'
    }
  }

  /** How far the target is from where it belongs, in pixels. */
  const drift = (): number => {
    const rect = target.getBoundingClientRect()
    const box = scroller.getBoundingClientRect()
    // A target taller than the viewport cannot be centred; start it instead.
    const wanted = center ? Math.max(0, (scroller.clientHeight - rect.height) / 2) : 0
    return rect.top - box.top - wanted
  }

  // Placed before the first frame when there is no glide to play, so arriving
  // on a new page at a fragment never shows a frame of its top first.
  if (!smooth) scroller.scrollTop += drift()

  let frame = 0
  let last = performance.now()
  const backstop = last + MAX_SETTLE_MS
  /** The floor on a step, in CSS pixels, on whatever display this is. */
  const minStep = MIN_STEP_DP / (window.devicePixelRatio || 1)
  let height = scroller.scrollHeight
  let steady = last

  const stop = (): void => {
    cancelAnimationFrame(frame)
    for (const event of TAKEOVER) scroller.removeEventListener(event, stop)
    window.removeEventListener('keydown', stop)
    cancelSettle = null
  }

  const tick = (now: number): void => {
    const elapsed = Math.min(now - last, MAX_FRAME_MS)
    last = now

    // Growing means pictures are still landing and the target is still moving.
    const grown = scroller.scrollHeight
    if (grown !== height) {
      height = grown
      steady = now
    }

    const off = drift()
    if (Math.abs(off) > SETTLE_SLOP) {
      // Frame-rate corrected, so the glide takes the same time at 60Hz as at
      // the 144 this is quite likely to be running at.
      const eased = off * (1 - Math.pow(1 - GLIDE, elapsed / FRAME_MS))
      const crawl = Math.sign(off) * Math.min(minStep, Math.abs(off))
      if (!smooth) scroller.scrollTop += off
      else scroller.scrollTop += Math.abs(eased) < minStep ? crawl : eased
      steady = now
    }

    if (now > backstop || now - steady > QUIET_MS) return stop()
    frame = requestAnimationFrame(tick)
  }

  frame = requestAnimationFrame(tick)
  // The click that started this has already been and gone, so its own
  // pointerdown cannot cancel the jump it asked for.
  for (const event of TAKEOVER) scroller.addEventListener(event, stop, { passive: true })
  window.addEventListener('keydown', stop)
  cancelSettle = stop
}

/**
 * Put the scroller back where a history entry left it, and hold it there.
 *
 * The same problem as an anchored jump — the page is shorter now than it was
 * when the offset was measured, because the images below the fold have not
 * arrived — but with no element to aim at, only a number. So the offset is
 * re-asserted whenever growth reveals there is more page to scroll into, and
 * only ever upward: Chromium's own scroll anchoring is holding the *visible*
 * content still as things load above it, and pushing the offset back down
 * would trade what the reader sees for a figure. Real input cancels it, and
 * once the height goes quiet whatever it settled on is the answer.
 */
function restoreScroll(scroller: HTMLElement, top: number): void {
  cancelSettle?.()

  // The images that decide the final layout are the ones above and inside the
  // remembered viewport; ask for them now. Re-run as the page grows, because
  // an unloaded image occupies nearly nothing — each pass promotes the ones
  // the last pass could finally place below the earlier arrivals.
  const eagerAbove = (): void => {
    const box = scroller.getBoundingClientRect()
    const limit = top + scroller.clientHeight
    for (const img of scroller.querySelectorAll<HTMLImageElement>('img[loading="lazy"]')) {
      const at = img.getBoundingClientRect().top - box.top + scroller.scrollTop
      if (at <= limit) img.loading = 'eager'
    }
  }

  eagerAbove()
  scroller.scrollTop = top

  let frame = 0
  const backstop = performance.now() + MAX_SETTLE_MS
  let height = scroller.scrollHeight
  let steady = performance.now()

  const stop = (): void => {
    cancelAnimationFrame(frame)
    for (const event of TAKEOVER) scroller.removeEventListener(event, stop)
    window.removeEventListener('keydown', stop)
    cancelSettle = null
  }

  const tick = (now: number): void => {
    const grown = scroller.scrollHeight
    if (grown !== height) {
      height = grown
      steady = now
      eagerAbove()
      if (scroller.scrollTop < top) scroller.scrollTop = top
    }
    if (now > backstop || now - steady > QUIET_MS) return stop()
    frame = requestAnimationFrame(tick)
  }

  frame = requestAnimationFrame(tick)
  for (const event of TAKEOVER) scroller.addEventListener(event, stop, { passive: true })
  window.addEventListener('keydown', stop)
  cancelSettle = stop
}

/**
 * Pin the whole page, from beside its title.
 *
 * The page-level counterpart to the section pins injected into the body, and
 * the GE Tracker star's shape: one control beside the name, filled when on.
 * Unpinning here takes the page's pinned sections with it — they belong to
 * the page entry.
 */
function PagePin({ title }: { title: string }): JSX.Element {
  const pins = usePins((s) => s.pages)
  const pinned = isPagePinned(pins, title)
  return (
    <button
      className={`rp-pin-btn article-pin ${pinned ? 'is-pinned' : ''}`}
      title={pinned ? 'Unpin this page (and any pinned sections)' : 'Pin this page'}
      onClick={() =>
        pinned ? usePins.getState().unpinPage(title) : usePins.getState().pinPage(title)
      }
    >
      <PinIcon />
    </button>
  )
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
  subject,
  form,
  onForm,
  variant,
  onVariant,
}: {
  box: InfoboxData
  /** The article's own title, for anything that must be named even if the card
   *  carries no header of its own. */
  subject: string
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
          // release dates and weights, and its cell trades the wiki's "(info)"
          // link for a View button into the price history.
          const isPrice = /^exchange$/i.test(row.label.replace(/<[^>]*>/g, '').trim())
          return (
            <div className={`infobox-row ${isPrice ? 'is-price' : ''}`} key={`${row.label}-${i}`}>
              <dt dangerouslySetInnerHTML={{ __html: row.label }} />
              {isPrice ? (
                <ExchangeCell html={value} />
              ) : (
                <dd dangerouslySetInnerHTML={{ __html: value }} />
              )}
            </div>
          )
        })}
      </dl>

      {current.map && <MapFrame map={current.map} title={header || subject} />}
    </aside>
  )
}

/** A map tile, as the wiki cuts them. */
const TILE_PX = 256

/**
 * Tallest the map may be in the card.
 *
 * The wiki asks for anything from 280 to 400 depending on the shape of the
 * place; 400 of a 300-wide panel is a lot of card to scroll past before the
 * article resumes.
 */
const MAP_MAX_PX = 300

/**
 * Where this place is, drawn from the wiki's own world map tiles.
 *
 * Cropped to the card rather than scaled down to it. The map is pixel art — the
 * town names and icons are drawn into the tiles at one size — so shrinking it
 * would blur exactly the labels that make it worth showing. Cropping costs
 * nothing instead, because the frame is centred on the subject's own square:
 * what is trimmed is the outer edge, and what the article is about stays in the
 * middle.
 */
function MapFrame({ map, title }: { map: InfoboxMapData; title: string }): JSX.Element {
  const [expanded, setExpanded] = useState(false)

  return (
    <figure className="infobox-map">
      <figcaption className="infobox-map-label">Map</figcaption>
      <div className="infobox-map-frame" style={{ height: Math.min(map.height, MAP_MAX_PX) }}>
        <div
          className="infobox-map-tiles"
          // Centred on the frame's midpoint by negative margins, which is what
          // makes the crop symmetrical however much wider than the card the
          // wiki's frame happens to be.
          style={{
            width: map.width,
            height: map.height,
            marginLeft: -map.width / 2,
            marginTop: -map.height / 2,
          }}
        >
          {map.tiles.map((tile) => (
            <img
              key={tile.src}
              src={tile.src}
              alt=""
              width={TILE_PX}
              height={TILE_PX}
              style={{ left: tile.x, top: tile.y }}
            />
          ))}
        </div>

        {/* Bottom right, where the wiki puts its own. */}
        <button
          className="infobox-map-expand"
          onClick={() => setExpanded(true)}
          title="Expand the map"
          aria-label="Expand the map"
        >
          <ExpandIcon />
        </button>
      </div>

      {expanded && <WorldMap map={map} title={title} onClose={() => setExpanded(false)} />}
    </figure>
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
