/**
 * Official hiscores.
 *
 * Jagex publishes one endpoint per account type, and an account appears on
 * every board it qualifies for — an ultimate ironman is on the ultimate,
 * ironman and main boards at once. There is no "what type is this account"
 * call, so the type is inferred by probing from most specific to least and
 * taking the first hit.
 *
 * That costs up to four requests for an ironman and one for everyone else,
 * which is why the answer is cached: looking the same person up twice in a
 * session should not re-probe.
 */

import * as client from '../wiki/client'
import { progressForXp, type Progress } from '../../shared/xp'

const BASE = 'https://secure.runescape.com'

export type AccountMode = 'main' | 'ironman' | 'hardcore' | 'ultimate'

/** Most specific first: the first board an account appears on names its type. */
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

  // An explicit mode is taken at face value; otherwise probe.
  const order = mode ? [mode] : PROBE_ORDER
  let lastError: unknown

  for (const candidate of order) {
    try {
      const result = await fetchMode(trimmed, candidate)
      cache.set(trimmed.toLowerCase(), result)
      return result
    } catch (err) {
      lastError = err
      // A 404 means "not on this board", which for a probe is information
      // rather than failure — keep going. Anything else is a real problem.
      if (!isNotFound(err)) throw err
    }
  }

  throw new Error(
    mode
      ? `“${trimmed}” is not on the ${MODE_LABEL[mode].toLowerCase()} hiscores.`
      : `No hiscores entry for “${trimmed}”. Check the spelling — names are exact.`
  )
  // `lastError` is deliberately unused past this point; the message above is
  // more useful than "HTTP 404".
  void lastError
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
    // Every activity is listed whether or not the account has done it, with
    // -1 for both fields. Showing 90 empty rows helps nobody.
    activities: (body.activities ?? []).filter((a) => a.score > 0),
    totalLevel: overall?.level ?? 0,
    totalXp: overall?.xp ?? 0,
    overallRank: overall?.rank ?? -1,
    fetchedAt: Date.now(),
  }
}

function isNotFound(err: unknown): boolean {
  return err instanceof Error && err.message.includes('404')
}
