/**
 * Your quests and combat achievements, as far as an article needs them.
 *
 * The counterpart to `player.ts`: that module holds skill levels from the
 * hiscores, this one holds quest states and combat-achievement completions from
 * RuneProfile. They stay separate on purpose — the hiscores answer for every
 * account in the game, while RuneProfile only answers for accounts running its
 * RuneLite plugin, and a page should keep marking skill requirements even when
 * quest marks have nothing to say.
 *
 * Loaded once per name, like the levels: the setting drives it, articles only
 * read the derived sets. The sets are keyed for the DOM's benefit — quest names
 * from the API match wiki page titles verbatim, so `data-title` on a link is
 * the join key, folded through `questKey` to survive the wiki's fondness for
 * curly apostrophes.
 */

import { create } from 'zustand'
import type { ProfileData, QuestProgress } from '@shared/ipc'

interface ProfileState {
  /** The name this data belongs to, so a rename invalidates it. */
  rsn: string | null
  data: ProfileData | null
  /**
   * `questKey(name)` to state, for every quest the API reports — all three
   * states, because a requirement wants red for "not started" as much as green
   * for "finished". Null until a lookup lands or when the account is unsynced.
   */
  questStates: Map<string, QuestProgress> | null
  /** Task ids the account has completed; the wiki stamps the same ids. */
  caCompleted: Set<number> | null
  /** `questKey(task name)` of completed tasks, for mentions outside task rows. */
  caCompletedNames: Set<string> | null
  loading: boolean
  error: string | null
  load: (rsn: string, options?: { force?: boolean }) => void
  clear: () => void
}

export const useProfile = create<ProfileState>((set, get) => ({
  rsn: null,
  data: null,
  questStates: null,
  caCompleted: null,
  caCompletedNames: null,
  loading: false,
  error: null,

  load: (rsn, options) => {
    const name = rsn.trim()
    if (!name) return get().clear()
    // Already have it, or already asking for it.
    if (get().loading) return
    if (!options?.force && get().rsn?.toLowerCase() === name.toLowerCase() && get().data) return

    set({ loading: true, error: null })
    window.rp
      .profileData(name, options)
      .then((data: ProfileData) => {
        if (!data.exists) {
          // A miss is a state, not a failure: the Character page explains it,
          // and the null sets below mean articles simply stay uncolored.
          set({
            rsn: name,
            data,
            questStates: null,
            caCompleted: null,
            caCompletedNames: null,
            loading: false,
            error: data.error ?? null,
          })
          return
        }
        const questStates = new Map<string, QuestProgress>()
        for (const quest of data.quests ?? []) {
          questStates.set(questKey(quest.name), quest.state)
        }
        const caCompleted = new Set<number>()
        const caCompletedNames = new Set<string>()
        for (const task of data.caTasks ?? []) {
          if (!task.completed) continue
          caCompleted.add(task.index)
          caCompletedNames.add(questKey(task.name))
        }
        set({
          rsn: data.username,
          data,
          questStates,
          caCompleted,
          caCompletedNames,
          loading: false,
          error: null,
        })
      })
      .catch((err: unknown) => {
        set({
          loading: false,
          data: null,
          questStates: null,
          caCompleted: null,
          caCompletedNames: null,
          error: err instanceof Error ? err.message : String(err),
        })
      })
  },

  clear: () =>
    set({
      rsn: null,
      data: null,
      questStates: null,
      caCompleted: null,
      caCompletedNames: null,
      loading: false,
      error: null,
    }),
}))

/**
 * One spelling for a name that exists in two hands.
 *
 * The API writes straight apostrophes, the wiki writes curly ones, and both
 * are hand-typed elsewhere; lowercase, straighten, and collapse runs of
 * whitespace so "My Arm's Big Adventure" is one key however it arrives.
 */
export function questKey(name: string): string {
  return name.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim()
}

/** The classes a quest link can wear, cleared before every pass. */
const QUEST_CLASSES = ['rp-quest-done', 'rp-quest-progress', 'rp-quest-todo'] as const
const QUEST_CLASS: Record<QuestProgress, string> = {
  finished: 'rp-quest-done',
  in_progress: 'rp-quest-progress',
  not_started: 'rp-quest-todo',
}

/**
 * Mark quest requirements under `root` against `states`.
 *
 * Deliberately narrower than "every link to a quest page": a quest name in
 * prose is a mention, not a question, and coloring it answers a question
 * nobody asked. The contexts that *are* questions come from two places:
 *
 * 1. The wiki's own quest-completion gadget marks them for us. The Quest
 *    details Requirements cell is `td.qc-input` and the quest tables — the
 *    quest list, "Quests requiring X", the optimal guide — are
 *    `table.qc-active`; that whitelist is maintained by the wiki's editors and
 *    never touches prose. Combat-achievement tables are `qc-active` too, so
 *    those are skipped here and handled by `markCaTasks` on their own terms.
 * 2. Plain "Requirements" sections (Barrows, minigames) carry no gadget class,
 *    so those are found by heading id and walked to the next heading.
 *
 * In both, set membership is the second guard: item links, skill links and
 * area links share these cells and simply never match a quest name.
 *
 * Idempotent and null-safe like `markRequirements` — clearing the name clears
 * the marks on the next pass.
 */
export function markQuests(root: Element, states: Map<string, QuestProgress> | null): void {
  const seen = new Set<HTMLAnchorElement>()

  const mark = (a: HTMLAnchorElement): void => {
    if (seen.has(a)) return
    seen.add(a)
    a.classList.remove(...QUEST_CLASSES)
    if (!states) return
    const title = a.dataset.title
    if (!title) return

    // Subquest pages have no entry of their own — the API reports "Recipe for
    // Disaster" once. A finished parent means every part is done; anything
    // else would be a guess, so anything else stays unmarked.
    if (title.startsWith('Recipe for Disaster/')) {
      if (states.get(questKey('Recipe for Disaster')) === 'finished') {
        a.classList.add('rp-quest-done')
      }
      return
    }

    const state = states.get(questKey(title))
    if (state) a.classList.add(QUEST_CLASS[state])
  }

  for (const a of root.querySelectorAll<HTMLAnchorElement>(
    'td.qc-input a[data-title], table.qc-active a[data-title]'
  )) {
    if (a.closest('table.ca-tasks')) continue
    mark(a)
  }

  // Requirements sections by heading. The wiki wraps each heading in
  // `div.mw-heading`; siblings up to the next heading belong to the section.
  for (const heading of root.querySelectorAll<HTMLElement>('.mw-heading')) {
    const id = heading.querySelector('h1, h2, h3, h4, h5, h6')?.id ?? ''
    if (!id.startsWith('Requirements')) continue
    for (
      let node = heading.nextElementSibling;
      node && !node.classList.contains('mw-heading');
      node = node.nextElementSibling
    ) {
      if (!/^(UL|OL|DL|TABLE)$/.test(node.tagName)) continue
      for (const a of node.querySelectorAll<HTMLAnchorElement>('a[data-title]')) mark(a)
    }
  }
}

/**
 * Mark completed combat-achievement tasks under `root`.
 *
 * Green or nothing, never red: a task you have not done is the page's default
 * state, and the point is spotting the ones already banked. Two passes with
 * different confidence. Task rows carry `data-ca-task-id`, the same id the API
 * calls `index` — exact, so the row is marked and CSS colors its name cell.
 * Mentions elsewhere fall back to the task's name against `data-title`; a page
 * title colliding with a task name can only ever gain a green it did not earn,
 * never a false "not done", which is why the fallback is completed-names only.
 */
export function markCaTasks(
  root: Element,
  ids: Set<number> | null,
  names: Set<string> | null
): void {
  for (const row of root.querySelectorAll<HTMLElement>('tr[data-ca-task-id]')) {
    row.classList.remove('rp-ca-done')
    if (!ids) continue
    const id = Number(row.dataset.caTaskId)
    if (Number.isFinite(id) && ids.has(id)) row.classList.add('rp-ca-done')
  }

  for (const a of root.querySelectorAll<HTMLAnchorElement>('a[data-title]')) {
    if (a.closest('tr[data-ca-task-id]')) continue
    a.classList.remove('rp-ca-done')
    if (!names) continue
    const title = a.dataset.title
    if (title && names.has(questKey(title))) a.classList.add('rp-ca-done')
  }
}
