/**
 * Official hiscores.
 *
 * Jagex publishes one endpoint per account type, and an account appears on
 * every board it qualifies for — an ultimate ironman is on the ultimate,
 * ironman and main boards at once. There is no "what type is this account"
 * call, so the type has to be inferred from which boards answer.
 *
 * Not by taking the most specific one, which is the obvious reading and is
 * wrong: a board an account no longer qualifies for freezes rather than drops
 * it, so a dead hardcore ironman still sits on the hardcore board at the stats
 * they died with. Every board is asked and the one with the most experience
 * wins, because boards only ever stop being written to — see `lookup`.
 *
 * That is four requests a lookup, which is why the answer is cached: looking
 * the same person up twice in a session should not re-probe.
 */

import * as client from '../wiki/client'
import { progressForXp, type Progress } from '../../shared/xp'

const BASE = 'https://secure.runescape.com'

export type AccountMode = 'main' | 'ironman' | 'hardcore' | 'ultimate'

/** Most specific first — the tie-break when several boards are equally current. */
const PROBE_ORDER: AccountMode[] = ['ultimate', 'hardcore', 'ironman', 'main']

const ENDPOINT: Record<AccountMode, string> = {
  main: 'm=hiscore_oldschool',
  ironman: 'm=hiscore_oldschool_ironman',
  hardcore: 'm=hiscore_oldschool_hardcore_ironman',
  ultimate: 'm=hiscore_oldschool_ultimate',
}

export const MODE_LABEL: Record<AccountMode, string> = {
  main: 'Main',
  ironman: 'Ironman',
  hardcore: 'Hardcore ironman',
  ultimate: 'Ultimate ironman',
}

export interface Skill {
  id: number
  name: string
  /** -1 when the account is unranked in this skill. */
  rank: number
  level: number
  xp: number
  progress: Progress
}

export interface Activity {
  id: number
  name: string
  rank: number
  score: number
}

export interface Hiscores {
  name: string
  mode: AccountMode
  skills: Skill[]
  /** Only the ones the account has actually done. */
  activities: Activity[]
  /** Combined level and experience, from the Overall row. */
  totalLevel: number
  totalXp: number
  overallRank: number
  fetchedAt: number
  /**
   * Other boards this name is listed on, most restrictive first.
   *
   * Non-empty means the account has changed type: a dead hardcore ironman is
   * still on the hardcore board, frozen, and a de-ironed account is still on the
   * ironman one. `mode` above is whichever board is still being written to.
   */
  alsoOn: AccountMode[]
}

interface LiteResponse {
  name?: string
  skills?: Array<{ id: number; name: string; rank: number; level: number; xp: number }>
  activities?: Array<{ id: number; name: string; rank: number; score: number }>
}

/** Keyed by lowercased name; hiscores names are case-insensitive. */
const cache = new Map<string, Hiscores>()
/** How long a lookup stays good. Hiscores update slowly. */
const MAX_AGE_MS = 5 * 60 * 1000

export function cached(name: string): Hiscores | null {
  const hit = cache.get(name.trim().toLowerCase())
  if (!hit) return null
  return Date.now() - hit.fetchedAt < MAX_AGE_MS ? hit : null
}

export async function lookup(name: string, mode?: AccountMode): Promise<Hiscores> {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Enter a username.')

  if (!mode) {
    const hit = cached(trimmed)
    if (hit) return hit
  }

  // An explicit mode is taken at face value.
  if (mode) {
    try {
      const result = await fetchMode(trimmed, mode)
      // Carry the other boards over from the probe that must have happened to
      // offer this one, minus the board now being shown. Without this, asking
      // for a specific board returns an entry that knows about no others, and
      // the view has no way back to the live one.
      const probed = cache.get(trimmed.toLowerCase())
      if (probed) {
        result.alsoOn = [probed.mode, ...probed.alsoOn].filter((m) => m !== mode)
      }
      return result
    } catch (err) {
      if (!isNotFound(err)) throw err
      throw new Error(`“${trimmed}” is not on the ${MODE_LABEL[mode].toLowerCase()} hiscores.`)
    }
  }

  /**
   * Every board at once, then pick the live one.
   *
   * An account is listed on every board it has ever qualified for, and the
   * stricter ones stop updating rather than disappearing. A hardcore ironman who
   * dies stays on the hardcore board frozen at the moment of death, while their
   * account carries on as a normal ironman — so taking the first board that
   * answers, which is what this used to do, showed a set of stats that could be
   * years out of date and no hint that it was.
   *
   * Total experience is what separates them: boards only ever freeze, never
   * rewind, so the highest total is by definition the one still being written
   * to. On a tie every board is current and the most restrictive is the truest
   * description of the account, which is what `PROBE_ORDER` is ordered by.
   */
  const found = (
    await Promise.all(
      PROBE_ORDER.map(async (candidate) => {
        try {
          return await fetchMode(trimmed, candidate)
        } catch (err) {
          // A 404 means "not on this board", which for a probe is information
          // rather than failure. Anything else is a real problem.
          if (isNotFound(err)) return null
          throw err
        }
      })
    )
  ).filter((r): r is Hiscores => r !== null)

  if (found.length === 0) {
    throw new Error(`No hiscores entry for “${trimmed}”. Check the spelling — names are exact.`)
  }

  const live = found.reduce((best, current) =>
    current.totalXp > best.totalXp ? current : best
  )
  // The boards it is also listed on, so the view can offer them. Ordered as
  // PROBE_ORDER is, most restrictive first.
  live.alsoOn = found.filter((r) => r.mode !== live.mode).map((r) => r.mode)

  cache.set(trimmed.toLowerCase(), live)
  return live
}

async function fetchMode(name: string, mode: AccountMode): Promise<Hiscores> {
  const url = `${BASE}/${ENDPOINT[mode]}/index_lite.json?player=${encodeURIComponent(name)}`
  const body = await client.getJson<LiteResponse>(url, 'interactive')

  const skills = (body.skills ?? []).map((s) => ({
    ...s,
    // The API reports -1 for an unranked skill; treat that as zero experience
    // so the progress maths does not produce a negative level.
    xp: Math.max(s.xp, 0),
    progress: progressForXp(Math.max(s.xp, 0)),
  }))

  const overall = skills.find((s) => s.name.toLowerCase() === 'overall')

  return {
    name: body.name ?? name,
    mode,
    // Overall is a summary row, not a skill; it is surfaced separately.
    skills: skills.filter((s) => s.name.toLowerCase() !== 'overall'),
    // Every activity is listed whether or not the account has done it, with -1
    // for both fields, and all of them are kept. That was a filter once, back
    // when this rendered as a list where an empty row was only noise. As a grid
    // of artwork the absences are the point — a boss you have never killed sits
    // in its place with a dash, which is how you notice it is there at all.
    activities: body.activities ?? [],
    totalLevel: overall?.level ?? 0,
    totalXp: overall?.xp ?? 0,
    overallRank: overall?.rank ?? -1,
    fetchedAt: Date.now(),
    // Filled in by `lookup` once it knows which other boards answered.
    alsoOn: [],
  }
}

function isNotFound(err: unknown): boolean {
  return err instanceof Error && err.message.includes('404')
}
