/**
 * The wiki's calculator pages, in the pane.
 *
 * These are real MediaWiki pages driven by MediaWiki's own JavaScript, so they
 * cannot go through the article transform — the transform strips exactly the
 * scripts that make them calculate. Showing the live page is not a shortcut
 * here; it is the only version that works.
 *
 * A `theme=dark` cookie set before load makes the wiki render dark server-side,
 * so it arrives correct rather than flashing white and being patched.
 */

import { useState, type JSX } from 'react'
import { ToolPane } from './ToolPane'

/** Curated: the wiki has hundreds and no index page worth embedding. */
const PAGES: Array<{ title: string; label: string }> = [
  { title: 'Calculator:Smithing', label: 'Smithing' },
  { title: 'Calculator:Herblore', label: 'Herblore' },
  { title: 'Calculator:Crafting', label: 'Crafting' },
  { title: 'Calculator:Construction', label: 'Construction' },
  { title: 'Calculator:Cooking', label: 'Cooking' },
  { title: 'Calculator:Farming', label: 'Farming' },
  { title: 'Calculator:Fletching', label: 'Fletching' },
  { title: 'Calculator:Magic', label: 'Magic' },
  { title: 'Calculator:Prayer', label: 'Prayer' },
  { title: 'Calculator:Runecraft', label: 'Runecraft' },
  { title: 'Calculator:Combat level', label: 'Combat level' },
  { title: 'Calculator:Skill calculators', label: 'All calculators' },
]

export function Calculators(): JSX.Element {
  const [page, setPage] = useState<string | null>(null)

  if (page) {
    return (
      <div className="tool-host">
        <div className="tool-bar">
          <button className="btn" onClick={() => setPage(null)}>
            ← All calculators
          </button>
          <span className="tool-bar-title">{PAGES.find((p) => p.title === page)?.label ?? page}</span>
        </div>
        <ToolPane id="calculators" arg={page} />
      </div>
    )
  }

  return (
    <div className="calc-picker">
      <h1>Calculators</h1>
      <p className="calc-note">
        The wiki&rsquo;s own calculators, shown live because they need MediaWiki&rsquo;s scripts to
        compute.
      </p>
      <div className="calc-grid">
        {PAGES.map((p) => (
          <button key={p.title} className="calc-card" onClick={() => setPage(p.title)}>
            {p.label}
          </button>
        ))}
      </div>
    </div>
  )
}
