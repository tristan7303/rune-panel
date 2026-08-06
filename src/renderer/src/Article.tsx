/**
 * The article view.
 *
 * The body arrives already sanitized and rewritten by main's transform, so this
 * only has to place it, intercept clicks on `rp://` links, and draw the infobox
 * natively. Everything expensive happened before the HTML crossed the bridge.
 */

import { useEffect, useRef, useState, type JSX } from 'react'
import type { Article as ArticleData, Infobox as InfoboxData } from '@shared/ipc'
import { useNav } from './nav'

/** Cursor dwell before a link is speculatively fetched. */
const HOVER_MS = 150

export function Article({ title }: { title: string }): JSX.Element {
  const [article, setArticle] = useState<ArticleData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  /** Bumped by the refresh control to re-run the fetch with force. */
  const [reloads, setReloads] = useState(0)
  const [variant, setVariant] = useState(0)
  const bodyRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const push = useNav((s) => s.push)

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
          setVariant(got.infobox?.defaultVariant ?? 0)
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

  // A new article starts at the top; without this the previous scroll position
  // survives the swap and you land mid-page.
  useEffect(() => {
    scrollRef.current?.scrollTo(0, 0)
  }, [title, article])

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
      const anchor = (e.target as HTMLElement).closest('a')
      if (!anchor) return

      const target = anchor.dataset.title
      if (target) {
        e.preventDefault()
        push({ kind: 'page', title: target })
        return
      }
      // External links are already target=_blank; main's window-open handler
      // sends them to the real browser.
      if (anchor.classList.contains('rp-external')) return

      // In-page anchors: scroll rather than navigate.
      const href = anchor.getAttribute('href') ?? ''
      if (href.startsWith('#')) {
        e.preventDefault()
        const id = decodeURIComponent(href.slice(1))
        root.querySelector(`[id="${CSS.escape(id)}"]`)?.scrollIntoView({ behavior: 'smooth' })
      }
    }

    let timer: number | undefined
    const onOver = (e: MouseEvent): void => {
      const anchor = (e.target as HTMLElement).closest('a')
      const target = anchor?.dataset.title
      if (!target) return
      window.clearTimeout(timer)
      // Dwell first: sweeping the cursor across a paragraph crosses a dozen
      // links, and prefetching each one would be the opposite of polite.
      timer = window.setTimeout(() => window.rp.prefetchPage(target), HOVER_MS)
    }
    const onOut = (): void => window.clearTimeout(timer)

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
        <h1 className="article-title">{article.title}</h1>

        <PriceHeader title={article.title} />

        {article.infobox && (
          <Infobox box={article.infobox} variant={variant} onVariant={setVariant} />
        )}

        <div
          className="article-body"
          ref={bodyRef}
          // Body blocks tagged by the transform reveal only the selected
          // variant, so the detail image follows the tabs.
          data-variant={variant}
          // Safe by construction: main strips script, style, event handlers and
          // javascript: URLs before this is ever cached. See wiki/transform.ts.
          dangerouslySetInnerHTML={{ __html: article.html }}
        />

        <Footer article={article} onRefresh={() => setReloads((n) => n + 1)} />
      </article>
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
      <button className="btn price-header-btn" onClick={() => push({ kind: 'ge', itemId: item.id })}>
        Price history
      </button>
      {item.name !== title && <span className="price-header-note">as {item.name}</span>}
    </div>
  )
}

function Infobox({
  box,
  variant,
  onVariant,
}: {
  box: InfoboxData
  variant: number
  onVariant: (v: number) => void
}): JSX.Element {
  const pick = (single: string, per?: Array<string | null>): string | null =>
    per ? per[variant] : single

  const header = box.headerByVariant?.[variant] ?? box.header
  const image = pick(box.image ?? '', box.imageByVariant)

  return (
    <aside className="infobox-card">
      {header && <h2 className="infobox-header">{header}</h2>}

      {box.variants.length > 1 && (
        <div className="infobox-tabs" role="tablist">
          {box.variants.map((name, i) => (
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

      {image && <div className="infobox-image" dangerouslySetInnerHTML={{ __html: image }} />}

      <dl className="infobox-rows">
        {box.rows.map((row, i) => {
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
