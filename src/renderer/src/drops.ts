/**
 * Drop rates: reading them, and saying them one way.
 *
 * The wiki writes a rate however the editor of that page felt like writing it.
 * `1/512` and `2/69` and `5/150` all appear, and so does `2 × 5/150` for a drop
 * rolled twice. Two items with the same odds can therefore look nothing alike,
 * and `2/69` takes arithmetic before it can be compared to anything.
 *
 * So everything is parsed to a single number — the denominator of the 1-in-N
 * form — and rendered back from that. `2/69` is `1/34.5`, `5/150` is `1/30`,
 * `1/512` is unchanged. One decimal place, because two is noise at these
 * magnitudes and none turns 34.5 into a lie.
 *
 * Parsing is deliberately forgiving and returns null rather than guessing: a
 * rate that reads "Varies" or carries a footnote is left exactly as written.
 */

/** A rate that always drops. Sorts ahead of every fraction. */
const ALWAYS = /^\s*always\s*$/i

/**
 * The thousands separators the wiki writes into a denominator.
 *
 * Rare drops are where they appear, and rare drops are where being wrong is
 * least forgivable: Scurrius drops a curved bone at `1/5,012.5`, and a pattern
 * that stops at the comma reads that as **1 in 5** — then colours it green as a
 * common drop, and hands the same figure to the badge beside the item's title.
 * Only a comma standing between two digits is removed, so a cell that separates
 * two rates with one keeps it.
 */
const GROUPING = /(?<=\d),(?=\d)/g

export interface DropRate {
  /** Exactly as the wiki wrote it — "2 × 5/150", "Always". */
  raw: string
  /**
   * Denominator of the 1-in-N form. 1 for a guaranteed drop, null when the
   * cell is prose rather than odds.
   */
  oneIn: number | null
  /** Rolls per kill, from the "2 ×" prefix. Almost always 1. */
  rolls: number
}

export function parseRate(raw: string): DropRate {
  const text = raw.replace(/\s+/g, ' ').trim()
  if (ALWAYS.test(text)) return { raw: text, oneIn: 1, rolls: 1 }

  // An optional "N ×" prefix, then a/b. The multiplication sign is the wiki's
  // own U+00D7, but an editor typing an ASCII x is common enough to accept.
  // Matched against the ungrouped form so a denominator in the thousands is
  // read whole; `raw` keeps the wiki's own spelling for the tooltip.
  const match = /^(?:(\d+)\s*[×x]\s*)?(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/.exec(
    text.replace(GROUPING, '')
  )
  if (!match) return { raw: text, oneIn: null, rolls: 1 }

  const rolls = match[1] ? Number(match[1]) : 1
  const numerator = Number(match[2])
  const denominator = Number(match[3])
  if (!(numerator > 0) || !(denominator > 0)) return { raw: text, oneIn: null, rolls }

  return { raw: text, oneIn: denominator / numerator, rolls }
}

/**
 * A denominator, grouped, with a trailing `.0` trimmed so a whole number does
 * not read as a measurement.
 *
 * Grouped because these run to five digits on the rarest drops and `1/5012.5`
 * takes a second look to place, which is the one thing a rarity column is for.
 * It also matches what the wiki wrote, so the rewritten cell and the tooltip
 * quoting the original agree on everything but the fraction itself.
 */
function trim(value: number): string {
  const rounded = Math.round(value * 10) / 10
  return rounded.toLocaleString('en-US', { maximumFractionDigits: 1 })
}

/**
 * The 1-in-N form, keeping any roll multiplier.
 *
 * The multiplier is kept rather than folded into the odds because it is a
 * different fact: "2 × 1/30" is two separate chances at a drop, not one chance
 * at 1/15, and collapsing it would misstate how many you can get in a kill.
 */
export function formatOneIn(rate: DropRate): string {
  if (rate.oneIn === null) return rate.raw
  if (rate.oneIn === 1) return rate.raw
  const odds = `1/${trim(rate.oneIn)}`
  return rate.rolls > 1 ? `${rate.rolls} × ${odds}` : odds
}

/**
 * The rarity class the wiki would have given this rate.
 *
 * The badge is not inside a drop table, so it has no `table-bg-` class to
 * inherit; the thresholds below reproduce the bands the wiki colours by, so a
 * rate reads the same colour in the title as it does in the table it came from.
 */
export function rarityClass(rate: DropRate): string {
  if (rate.oneIn === null) return 'table-bg-fade'
  if (rate.oneIn <= 1) return 'table-bg-always'
  if (rate.oneIn < 25) return 'table-bg-common'
  if (rate.oneIn < 100) return 'table-bg-uncommon'
  if (rate.oneIn < 1000) return 'table-bg-rare'
  return 'table-bg-veryrare'
}

export interface DropSource {
  /** The monster or chest that drops it. */
  source: string
  /** Where clicking should land — the article title, when it is a real link. */
  title: string | null
  rate: DropRate
  quantity: string
}

/**
 * Read the "Item sources" table off an item page.
 *
 * Item pages carry one table headed `Source | Level | Quantity | Rarity`, which
 * is the only structured statement anywhere of what drops a thing and how
 * often. It is matched on those headers rather than a class, because the class
 * varies and the headers do not.
 *
 * Read from the rendered DOM rather than parsed in main, so that turning the
 * setting off and on again is instant and the page cache stays a plain copy of
 * the wiki.
 */
export function readDropSources(root: ParentNode): DropSource[] {
  for (const table of root.querySelectorAll('table')) {
    const headers = [...table.querySelectorAll('th')].map((th) =>
      (th.textContent ?? '').trim().toLowerCase()
    )
    if (!headers.includes('source') || !headers.includes('rarity')) continue

    const sourceAt = headers.indexOf('source')
    const rarityAt = headers.indexOf('rarity')
    const quantityAt = headers.indexOf('quantity')

    const out: DropSource[] = []
    for (const tr of table.querySelectorAll('tbody tr')) {
      const cells = [...tr.children].filter((c) => c.tagName === 'TD')
      if (cells.length <= Math.max(sourceAt, rarityAt)) continue

      const sourceCell = cells[sourceAt]
      const source = (sourceCell?.textContent ?? '').trim()
      const rateText = (cells[rarityAt]?.textContent ?? '').trim()
      if (!source || !rateText) continue

      // The link carries the canonical title; the cell text may append a
      // qualifier like "Abyssal demon Standard" that is not a page.
      const link = sourceCell?.querySelector<HTMLElement>('a[data-title]')
      out.push({
        source,
        title: link?.dataset.title ?? null,
        rate: parseRate(rateText),
        quantity: quantityAt >= 0 ? ((cells[quantityAt]?.textContent ?? '').trim() || '1') : '1',
      })
    }
    if (out.length > 0) return out
  }
  return []
}

/**
 * Most common first, or rarest first.
 *
 * A rate we could not parse sorts last either way: it is not a number, so it
 * has no place on the ramp, and dropping it to the end keeps the badges that do
 * mean something at the front where they are read.
 */
export function sortSources(sources: DropSource[], order: 'common' | 'rare'): DropSource[] {
  const rank = (s: DropSource): number => s.rate.oneIn ?? Number.POSITIVE_INFINITY
  const known = (s: DropSource): number => (s.rate.oneIn === null ? 1 : 0)
  return [...sources].sort((a, b) => {
    if (known(a) !== known(b)) return known(a) - known(b)
    return order === 'common' ? rank(a) - rank(b) : rank(b) - rank(a)
  })
}

/**
 * Rewrite every rarity cell in the body to the 1-in-N form.
 *
 * Off by default, because the wiki's own wording carries information the odds
 * do not — `5/150` says the drop occupies five slots in a table of a hundred and
 * fifty, which is how the drop is actually implemented. The original goes into
 * `title` so hovering still answers, and the first pass stores it in a data
 * attribute so toggling the setting back restores rather than re-deriving from
 * text this function already rewrote.
 */
export function normaliseRateCells(root: ParentNode, on: boolean): void {
  for (const cell of root.querySelectorAll<HTMLElement>('td[class*="table-bg-"]')) {
    const original = cell.dataset.rpRate ?? cell.textContent ?? ''
    if (!original.trim()) continue

    if (!on) {
      if (cell.dataset.rpRate !== undefined) {
        cell.textContent = cell.dataset.rpRate
        delete cell.dataset.rpRate
        cell.removeAttribute('title')
      }
      continue
    }

    const rate = parseRate(original)
    if (rate.oneIn === null || rate.oneIn === 1) continue
    const next = formatOneIn(rate)
    if (next === original.trim()) continue

    if (cell.dataset.rpRate === undefined) cell.dataset.rpRate = original
    cell.textContent = next
    cell.title = `${rate.raw} on the wiki`
  }
}
