/**
 * Your own account, as far as an article needs to know it.
 *
 * The wiki marks a requirement you meet differently from one you do not, and
 * that is the whole of what this holds: a skill name to a level. It comes from
 * the hiscores, which are public and need no login — the name in settings is the
 * only input.
 *
 * Quests and combat achievements live in `runeprofile.ts` instead. They are
 * not on the hiscores at all, and for a long time the only place they existed
 * was the wiki's WikiSync service, whose maintainers ask third parties not to
 * read it — RuneProfile is the answer to that: an opt-in service with a public
 * API. Skills stay here regardless, because the hiscores answer for every
 * account while RuneProfile only knows the ones running its plugin.
 */

import { create } from 'zustand'
import type { Hiscores } from '@shared/ipc'

interface PlayerState {
  /** The name these levels belong to, so a rename invalidates them. */
  rsn: string | null
  /**
   * Lowercased skill name to level.
   *
   * Null until a lookup lands. A skill the account is unranked in is *absent*
   * rather than zero: the hiscores report level 1 for unranked, and marking a
   * requirement failed on that basis would be a guess dressed as an answer.
   */
  levels: Record<string, number> | null
  loading: boolean
  error: string | null
  load: (rsn: string) => void
  clear: () => void
}

export const usePlayer = create<PlayerState>((set, get) => ({
  rsn: null,
  levels: null,
  loading: false,
  error: null,

  load: (rsn) => {
    const name = rsn.trim()
    if (!name) return get().clear()
    // Already have it, or already asking for it.
    if (get().loading) return
    if (get().rsn?.toLowerCase() === name.toLowerCase() && get().levels) return

    set({ loading: true, error: null })
    window.rp
      .hiscores(name)
      .then((data: Hiscores) => {
        const levels: Record<string, number> = {}
        for (const skill of data.skills) {
          if (skill.rank < 0) continue
          levels[skill.name.toLowerCase()] = skill.level
        }
        set({ rsn: data.name, levels, loading: false, error: null })
      })
      .catch((err: unknown) => {
        set({
          loading: false,
          levels: null,
          error: err instanceof Error ? err.message : String(err),
        })
      })
  },

  clear: () => set({ rsn: null, levels: null, loading: false, error: null }),
}))

/** Where the hiscores view keeps the names you have looked up, most recent first. */
const HISCORES_MRU = 'rp.hiscores'
/** Set once the seed below has had its one chance, so clearing the field sticks. */
const SEEDED = 'rp.rsn.seeded'

/**
 * Carry a name over from the hiscores view, once.
 *
 * The setting is new; anyone already using the app has typed their name into
 * the hiscores box and it is sitting at the top of that list. Asking them to
 * type it a second time to turn on a feature they have not heard of yet means
 * most people never see it work.
 *
 * Guarded rather than conditioned only on emptiness, so deliberately clearing
 * the field does not refill itself on the next launch.
 */
export function seedRsn(current: string): string | null {
  if (current.trim()) return null
  if (localStorage.getItem(SEEDED)) return null
  localStorage.setItem(SEEDED, '1')
  try {
    const saved = JSON.parse(localStorage.getItem(HISCORES_MRU) ?? '[]') as unknown
    if (!Array.isArray(saved)) return null
    const first = saved.find((n): n is string => typeof n === 'string' && n.trim().length > 0)
    return first?.trim() ?? null
  } catch {
    return null
  }
}

/**
 * The level a requirement asks for.
 *
 * `data-level` is written by hand across thousands of pages and reads "70",
 * "90+", "70–80", "+75" and occasionally "Decent". The first number in it is the
 * requirement in every numeric form; anything with no number is a note rather
 * than a level and gets marked neither way.
 */
export function requiredLevel(raw: string | undefined): number | null {
  const found = /\d+/.exec(raw ?? '')
  if (!found) return null
  const level = Number(found[0])
  return level >= 1 && level <= 126 ? level : null
}

/**
 * Mark every skill requirement under `root` against `levels`.
 *
 * Works on the injected article body and the natively-drawn infobox alike, which
 * is why it takes a root rather than reaching for one: requirement rows live in
 * both, and the infobox is a sibling of the body rather than part of it.
 */
export function markRequirements(root: Element, levels: Record<string, number> | null): void {
  for (const span of root.querySelectorAll<HTMLElement>('.scp[data-skill]')) {
    span.classList.remove('rp-req-met', 'rp-req-unmet')
    if (!levels) continue

    const skill = span.dataset.skill?.trim().toLowerCase()
    const need = requiredLevel(span.dataset.level)
    if (!skill || need === null) continue

    const have = levels[skill]
    if (have === undefined) continue
    span.classList.add(have >= need ? 'rp-req-met' : 'rp-req-unmet')
  }
}

/**
 * The wiki's bracketed requirement notes, abbreviated.
 *
 * A quest's Requirements cell hangs `[not boostable]` and `[required to start]`
 * off half its entries, and at full length the notes outweigh the requirements
 * they annotate. Each note is a `<sup class="nowrap">` whose inner span carries
 * the explanation as a `title` tooltip — so only the visible text is shortened,
 * and hovering still says what the letters mean.
 *
 * Done here rather than in the transform so pages already sitting in the cache
 * get it too. Idempotent by construction: the shortened text no longer matches.
 */
const TAG_SHORT: Record<string, string> = {
  'not boostable': 'nb',
  'required to start': 'rq',
}

export function abbreviateRequirementTags(root: Element): void {
  for (const span of root.querySelectorAll<HTMLElement>('sup.nowrap span[title]')) {
    const short = TAG_SHORT[span.textContent?.trim().toLowerCase() ?? '']
    if (short) span.textContent = short
  }
}

/** The class a hidden fulfilled requirement wears. */
const REQ_HIDDEN = 'rp-req-hidden'

/**
 * Hide requirement entries the account has already fulfilled.
 *
 * Runs after the marking passes and reads their classes rather than the data
 * again, so the two can never disagree about what "met" means. Scoped to the
 * same contexts `markQuests` treats as questions — the quest-details cell
 * (`td.qc-input`) and plain Requirements sections — because a met skill in a
 * gear table or prose is information, not a checklist entry.
 *
 * Hiding needs positive evidence. An entry goes only when everything checkable
 * in it is green — every skill marker met, every quest link finished — and at
 * least one such mark exists. A link with no mark is an unknown (no name set,
 * an unsynced account, or simply a monster in "Ability to defeat X"), and
 * unknowns stay visible: the switch trims what you have done, it must never
 * trim what it cannot vouch for.
 *
 * A fulfilled entry takes its sub-requirements with it — a finished quest's own
 * requirement tree is spent — while an unfulfilled parent keeps its children
 * individually judged. Idempotent like the marking passes: every hidden class
 * is cleared before the pass, so toggling the setting off restores the page.
 */
export function pruneMetRequirements(root: Element, enabled: boolean): void {
  for (const el of root.querySelectorAll(`.${REQ_HIDDEN}`)) el.classList.remove(REQ_HIDDEN)
  if (!enabled) return

  const contexts: Element[] = [...root.querySelectorAll('td.qc-input')]

  // Requirements sections by heading — the same walk markQuests does, kept in
  // step with it: siblings up to the next heading belong to the section.
  for (const heading of root.querySelectorAll<HTMLElement>('.mw-heading')) {
    const id = heading.querySelector('h1, h2, h3, h4, h5, h6')?.id ?? ''
    if (!id.startsWith('Requirements')) continue
    for (
      let node = heading.nextElementSibling;
      node && !node.classList.contains('mw-heading');
      node = node.nextElementSibling
    ) {
      if (/^(UL|OL)$/.test(node.tagName)) contexts.push(node)
    }
  }

  for (const context of contexts) {
    for (const li of context.querySelectorAll<HTMLElement>('li')) {
      if (fulfilled(li)) li.classList.add(REQ_HIDDEN)
    }
  }
}

/**
 * Is this entry's own line fully met?
 *
 * Judged on the entry's direct content only — markers belonging to a nested
 * entry answer for that entry, not this one. Skill links live inside their
 * `.scp` marker and are part of it; any other unmarked link is an unknown and
 * vetoes the hide.
 */
function fulfilled(li: HTMLElement): boolean {
  let met = 0
  for (const el of li.querySelectorAll<HTMLElement>('.scp, a[data-title]')) {
    if (el.closest('li') !== li) continue
    if (el.classList.contains('scp')) {
      if (!el.classList.contains('rp-req-met')) return false
      met++
    } else if (!el.closest('.scp')) {
      if (!el.classList.contains('rp-quest-done')) return false
      met++
    }
  }
  return met > 0
}
