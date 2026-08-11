/**
 * The Pinned view.
 *
 * Everything you have pinned, in pin order: a card per page, and inside it a
 * block per pinned section rendering the section's actual content — the point
 * of pinning DT2's Requirements is reading the requirements, not a link to
 * them. A page pinned with no sections is just a link card.
 *
 * Content comes from the page cache via `getPage` (which fetches on a miss, so
 * a pin made on another machine still resolves) and is cut down by
 * `extractSectionHtml`. The fragments get the same after-render passes an
 * article gets — abbreviated tags, skill and quest marks, met-requirement
 * pruning — so a pinned Requirements list is coloured exactly as it is on the
 * page, live against the same account state.
 */

import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { Article as ArticleData } from '@shared/ipc'
import { useNav } from './nav'
import { useStore } from './store'
import { PinIcon } from './icons'
import { usePins, QD_PREFIX, type PinnedPage, type PinnedSection } from './pins'
import { extractSectionHtml } from './sections'
import {
  usePlayer,
  markRequirements,
  abbreviateRequirementTags,
  pruneMetRequirements,
} from './player'
import { useProfile, markQuests, markCaTasks } from './runeprofile'

/** `decodeURIComponent` without a bare `%` throwing — same as the article's. */
function decodeFragment(raw: string): string {
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

export function Pinned(): JSX.Element {
  const pages = usePins((s) => s.pages)
  const push = useNav((s) => s.push)

  /**
   * One delegated handler for every rendered fragment, since their markup is
   * `innerHTML` and cannot carry React handlers. The same three cases the
   * article body handles: wiki links navigate, external links pass through to
   * the browser, and in-page anchors open the pinned page *at* that section —
   * "there" is on the article, not in this view.
   */
  const onClick = (e: React.MouseEvent): void => {
    const anchor = (e.target as HTMLElement).closest('a')
    if (!anchor) return

    const title = anchor.dataset.title
    if (title) {
      e.preventDefault()
      const fragment = anchor.getAttribute('href')?.split('#')[1]
      push({ kind: 'page', title, hash: fragment ? decodeFragment(fragment) : undefined })
      return
    }
    if (anchor.classList.contains('rp-external')) return

    const href = anchor.getAttribute('href') ?? ''
    if (href.startsWith('#')) {
      e.preventDefault()
      const page = anchor.closest<HTMLElement>('[data-pin-title]')?.dataset.pinTitle
      if (page) push({ kind: 'page', title: page, hash: decodeFragment(href.slice(1)) })
    }
  }

  if (pages.length === 0) {
    return (
      <div className="pinned-empty">
        <PinIcon />
        <h1>Nothing pinned yet</h1>
        <p>
          Pin a page from the button beside its title, or a section from the pin that appears
          when you hover its heading — on quest pages, the Requirements row of the details
          table can be pinned too.
        </p>
      </div>
    )
  }

  return (
    <div className="pinned-view" onClick={onClick}>
      {pages.map((page) => (
        <PinnedPageCard key={page.title} page={page} />
      ))}
    </div>
  )
}

function PinnedPageCard({ page }: { page: PinnedPage }): JSX.Element {
  const hasSections = page.sections.length > 0
  const [article, setArticle] = useState<ArticleData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(hasSections)
  const push = useNav((s) => s.push)
  const unpinPage = usePins((s) => s.unpinPage)

  // Only fetched when something will be rendered from it. A link card needs
  // nothing but its title, and fetching every pinned page to draw a button
  // would be the crawler's job done badly.
  useEffect(() => {
    if (!hasSections) return
    let live = true
    setLoading(true)
    setError(null)
    window.rp
      .getPage(page.title)
      .then((got) => {
        if (!live) return
        if (!got) setError(`No article named “${page.title}”.`)
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
  }, [page.title, hasSections])

  return (
    <section className="pinned-card" data-pin-title={page.title}>
      <header className="pinned-card-head">
        <button className="pinned-title" onClick={() => push({ kind: 'page', title: page.title })}>
          {page.title}
        </button>
        <button
          className="rp-pin-btn is-pinned"
          title={`Unpin ${page.title}${page.sections.length > 0 ? ' and its sections' : ''}`}
          onClick={() => unpinPage(page.title)}
        >
          <PinIcon />
        </button>
      </header>

      {loading && <p className="pinned-note">Loading {page.title}…</p>}
      {error && <p className="pinned-note">{error}</p>}

      {article &&
        page.sections.map((section) => (
          <PinnedSectionBlock
            key={section.anchor}
            pageTitle={page.title}
            section={section}
            article={article}
          />
        ))}
    </section>
  )
}

function PinnedSectionBlock({
  pageTitle,
  section,
  article,
}: {
  pageTitle: string
  section: PinnedSection
  article: ArticleData
}): JSX.Element {
  const bodyRef = useRef<HTMLDivElement>(null)
  const push = useNav((s) => s.push)
  const unpinSection = usePins((s) => s.unpinSection)
  const levels = usePlayer((s) => s.levels)
  const questStates = useProfile((s) => s.questStates)
  const caCompleted = useProfile((s) => s.caCompleted)
  const caCompletedNames = useProfile((s) => s.caCompletedNames)
  const hideMet = useStore((s) => s.settings?.hideMetRequirements ?? false)

  const html = useMemo(
    () => extractSectionHtml(article.html, section.anchor),
    [article, section.anchor]
  )
  // One object per fragment, for the same reason the article memoises its
  // body: a fresh `{ __html }` every render re-sets innerHTML and wipes the
  // marks written after it.
  const markup = useMemo(() => (html === null ? null : { __html: html }), [html])

  /** Same passes, same order as the article view runs them. */
  useEffect(() => {
    const root = bodyRef.current
    if (!root) return
    abbreviateRequirementTags(root)
    markRequirements(root, levels)
    markQuests(root, questStates)
    markCaTasks(root, caCompleted, caCompletedNames)
    pruneMetRequirements(root, hideMet)
  }, [markup, levels, questStates, caCompleted, caCompletedNames, hideMet])

  const isHeading = !section.anchor.startsWith(QD_PREFIX)

  return (
    <div className="pinned-section">
      <header className="pinned-section-head">
        <button
          className="pinned-section-title"
          // A heading pin can land on its own section; a quest-details row has
          // no anchor on the page, and its table sits at the top anyway.
          onClick={() =>
            push({
              kind: 'page',
              title: pageTitle,
              hash: isHeading ? section.anchor : undefined,
            })
          }
        >
          {section.line}
        </button>
        <button
          className="rp-pin-btn is-pinned"
          title={`Unpin ${section.line}`}
          onClick={() => unpinSection(pageTitle, section.anchor)}
        >
          <PinIcon />
        </button>
      </header>

      {markup ? (
        <div className="pinned-section-body">
          {/* data-variant pins multi-variant blocks to their default form,
              as a freshly opened article shows them. Safe by the same
              argument as the article body: main sanitized it. */}
          <div className="article-body" data-variant={0} ref={bodyRef} dangerouslySetInnerHTML={markup} />
        </div>
      ) : (
        <p className="pinned-note">
          This section is no longer on the page — it may have been renamed in a wiki edit.
        </p>
      )}
    </div>
  )
}
