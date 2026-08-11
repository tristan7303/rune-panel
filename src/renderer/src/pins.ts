/**
 * Pinned pages and sections.
 *
 * The counterpart to GE Tracker's starred items, for articles: pin a page, or
 * pin one section of it, and the Pinned view collects them. Pinning a section
 * pins its page implicitly — a section is meaningless without the page it
 * belongs to — while unpinning a section leaves the page pinned as a plain
 * link.
 *
 * Stored in localStorage like every other renderer-only convenience list (the
 * hiscores MRU, the GE Tracker stars): a schema migration for a list of titles
 * would be the wrong trade. A zustand store wraps it rather than component
 * state, because two views mutate the same list — the article's pin buttons
 * and the Pinned view's unpin controls — and both must see a change the moment
 * it happens, not on their next mount.
 *
 * A section's identity is its `anchor`: a heading's element id, or
 * `qd:<row header>` for a quest-details table row — "Requirements" on a quest
 * page is a table row, not a heading, and it is the single most pinnable thing
 * in the app. `line` is the display text, stored because the Pinned view
 * should be able to name a section without fetching its page first.
 */

import { create } from 'zustand'

export interface PinnedSection {
  anchor: string
  line: string
}

export interface PinnedPage {
  /** The canonical article title — pins are only offered once a page loaded. */
  title: string
  sections: PinnedSection[]
}

/** Prefix marking a quest-details row pin; the rest is the row's header text. */
export const QD_PREFIX = 'qd:'

const PINS_KEY = 'rp.pins'

function load(): PinnedPage[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(PINS_KEY) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((p): p is PinnedPage => !!p && typeof (p as PinnedPage).title === 'string')
      .map((p) => ({
        title: p.title,
        sections: Array.isArray(p.sections)
          ? p.sections.filter(
              (s) => !!s && typeof s.anchor === 'string' && typeof s.line === 'string'
            )
          : [],
      }))
  } catch {
    return []
  }
}

function save(pages: PinnedPage[]): void {
  try {
    localStorage.setItem(PINS_KEY, JSON.stringify(pages))
  } catch {
    // Storage disabled or full; a pin list is not worth failing over.
  }
}

interface PinsState {
  pages: PinnedPage[]
  pinPage: (title: string) => void
  /** Removes the page and every section pinned under it. */
  unpinPage: (title: string) => void
  /** Pins the page too, if it was not already. */
  pinSection: (title: string, anchor: string, line: string) => void
  /** The page stays pinned — it was, the moment a section of it was. */
  unpinSection: (title: string, anchor: string) => void
}

export const usePins = create<PinsState>((set, get) => {
  const commit = (pages: PinnedPage[]): void => {
    save(pages)
    set({ pages })
  }

  return {
    pages: load(),

    pinPage: (title) => {
      const { pages } = get()
      if (pages.some((p) => p.title === title)) return
      commit([...pages, { title, sections: [] }])
    },

    unpinPage: (title) => {
      commit(get().pages.filter((p) => p.title !== title))
    },

    pinSection: (title, anchor, line) => {
      const { pages } = get()
      const page = pages.find((p) => p.title === title)
      if (!page) {
        commit([...pages, { title, sections: [{ anchor, line }] }])
        return
      }
      if (page.sections.some((s) => s.anchor === anchor)) return
      commit(
        pages.map((p) =>
          p === page ? { ...p, sections: [...p.sections, { anchor, line }] } : p
        )
      )
    },

    unpinSection: (title, anchor) => {
      commit(
        get().pages.map((p) =>
          p.title === title ? { ...p, sections: p.sections.filter((s) => s.anchor !== anchor) } : p
        )
      )
    },
  }
})

/** Plain functions rather than hooks, so delegated click handlers can ask too. */
export function isPagePinned(pages: PinnedPage[], title: string): boolean {
  return pages.some((p) => p.title === title)
}

export function isSectionPinned(pages: PinnedPage[], title: string, anchor: string): boolean {
  return pages.find((p) => p.title === title)?.sections.some((s) => s.anchor === anchor) ?? false
}
