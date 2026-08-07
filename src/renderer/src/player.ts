/**
 * Your own account, as far as an article needs to know it.
 *
 * The wiki marks a requirement you meet differently from one you do not, and
 * that is the whole of what this holds: a skill name to a level. It comes from
 * the hiscores, which are public and need no login — the name in settings is the
 * only input.
 *
 * Quests and combat achievements are deliberately absent. They are not on the
 * hiscores at all, and the only place they exist is the wiki's own WikiSync
 * service: the local endpoint its DPS calculator talks to serves a loadout and
 * eight combat levels and nothing else, and the rest is uploaded to a server
 * whose maintainers ask third parties not to read it. So skills it is, rather
 * than a feature that half works against an API we were asked to leave alone.
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
