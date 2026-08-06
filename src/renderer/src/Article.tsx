/**
 * The article view.
 *
 * The body arrives already sanitized and rewritten by main's transform, so this
 * only has to place it, intercept clicks on `rb://` links, and draw the infobox
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
  const bodyRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const push = useNav((s) => s.push)

  useEffect(() => {
    let live = true
    setLoading(true)
    setError(null)
    setArticle(null)

    window.rb
      .getPage(title, { force: reloads > 0 })
      .then((got) => {
        if (!live) return
        if (!got) setError(`No article named “${title}”.`)
        else setArticle(got)
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
      if (anchor.classList.contains('rb-external')) return

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
      timer = window.setTimeout(() => window.rb.prefetchPage(target), HOVER_MS)
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

        {article.infobox && <Infobox box={article.infobox} />}

        <div
          className="article-body"
          ref={bodyRef}
          // Safe by construction: main strips script, style, event handlers and
          // javascript: URLs before this is ever cached. See wiki/transform.ts.
          dangerouslySetInnerHTML={{ __html: article.html }}
        />

        <Footer article={article} onRefresh={() => setReloads((n) => n + 1)} />
      </article>
    </div>
  )
}

function Infobox({ box }: { box: InfoboxData }): JSX.Element {
  return (
    <aside className="infobox-card">
      {box.header && <h2 className="infobox-header">{box.header}</h2>}
      {box.image && (
        <div className="infobox-image" dangerouslySetInnerHTML={{ __html: box.image }} />
      )}
      <dl className="infobox-rows">
        {box.rows.map((row, i) => (
          <div className="infobox-row" key={`${row.label}-${i}`}>
            <dt dangerouslySetInnerHTML={{ __html: row.label }} />
            <dd dangerouslySetInnerHTML={{ __html: row.value }} />
          </div>
        ))}
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
        <a href={url} target="_blank" rel="noreferrer" className="rb-external">
          Old School RuneScape Wiki
        </a>
        , licensed{' '}
        <a
          href="https://creativecommons.org/licenses/by-nc-sa/3.0/"
          target="_blank"
          rel="noreferrer"
          className="rb-external"
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
