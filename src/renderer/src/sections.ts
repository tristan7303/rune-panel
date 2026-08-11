/**
 * Extracting one section's HTML out of a cached article.
 *
 * The Pinned view renders a pinned section's actual content, and this is where
 * the content comes from: the page's transformed HTML (already through main's
 * sanitizer — the same safety argument the footnote hover card makes), parsed
 * off-DOM and cut down to the piece asked for. Extraction runs at render time
 * against the page cache rather than storing a fragment at pin time, so a
 * pinned section is as current as the page itself and never rots on its own.
 *
 * Two kinds of anchor, matching what can be pinned:
 *
 *  - A heading's element id. The fragment is the heading and everything up to
 *    the next heading of the same or a higher level, so pinning an h2 carries
 *    its h3/h4 subsections — cut at *any* next heading, "Strategies" would
 *    arrive without its equipment tables.
 *  - `qd:<row header>` — a quest-details table row, because "Requirements" on
 *    a quest page is a row of that table, not a heading. The whole `<tr>` is
 *    kept and rewrapped in a `table.questdetails` shell: the row's `td` carries
 *    the `qc-input` class the quest-marking pass keys on, and the table class
 *    is what the stylesheet scopes the quest-details treatment to.
 *
 * Null means the anchor no longer resolves — a wiki edit renamed the heading —
 * and the caller shows a fallback rather than nothing.
 */

import { QD_PREFIX } from './pins'

export function extractSectionHtml(pageHtml: string, anchor: string): string | null {
  const doc = new DOMParser().parseFromString(pageHtml, 'text/html')

  if (anchor.startsWith(QD_PREFIX)) {
    const header = anchor.slice(QD_PREFIX.length)
    for (const th of doc.querySelectorAll('th.questdetails-header')) {
      if (th.textContent?.trim() !== header) continue
      const row = th.closest('tr')
      if (!row) return null
      return `<table class="questdetails"><tbody>${row.outerHTML}</tbody></table>`
    }
    return null
  }

  const heading = doc.getElementById(anchor)
  if (!heading) return null
  const level = Number(/^H([2-6])$/.exec(heading.tagName)?.[1] ?? 2)

  // MediaWiki wraps each heading in `.mw-heading`; the walk is over those
  // wrappers, and the fragment keeps them — the marking passes locate
  // Requirements sections by finding `.mw-heading` and walking its siblings,
  // which still works when the fragment's children share one parent div.
  const start = heading.closest('.mw-heading') ?? heading
  const parts: string[] = [start.outerHTML]
  for (let node = start.nextElementSibling; node; node = node.nextElementSibling) {
    if (node.classList.contains('mw-heading')) {
      const next = node.querySelector('h1, h2, h3, h4, h5, h6')
      const nextLevel = Number(/^H([1-6])$/.exec(next?.tagName ?? '')?.[1] ?? 0)
      if (nextLevel > 0 && nextLevel <= level) break
    }
    parts.push(node.outerHTML)
  }
  return parts.join('')
}
