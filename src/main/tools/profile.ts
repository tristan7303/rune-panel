/**
 * RuneProfile account lookup.
 *
 * Two callers, two shapes. The native search page wants `lookup()` — a summary
 * card that can tell you a username is wrong *before* loading a pane that would
 * just say so less clearly. The Character page and the article markers want
 * `data()` — the summary plus every quest state, every combat-achievement task,
 * and the skills, fetched together and cached together so one setting change
 * costs the API four requests and no more.
 *
 * Anonymous access is 30 requests a minute, which is far more than either
 * caller needs; an optional API key raises it to 120 and is not worth asking
 * for.
 */

import * as client from '../wiki/client'
import type {
  ProfileCaTask,
  ProfileCaTier,
  ProfileData,
  ProfileDiary,
  ProfileQuest,
  ProfileSkill,
  ProfileSummary,
} from '../../shared/ipc'

const API = 'https://api.runeprofile.com/v1'

/**
 * What the API actually returns.
 *
 * `skills` is an object of totals, **not** an array of skills — an earlier
 * version here assumed the latter and called `.filter` on it, which is what
 * every lookup was failing with. The endpoint also carries account type, clan,
 * quest and collection-log progress, all of which make a better summary card
 * than a bare username.
 */
interface AccountResponse {
  username?: string
  accountType?: { key?: string; name?: string } | null
  clan?: { name?: string } | null
  skills?: { totalLevel?: number; totalXp?: number } | null
  quests?: {
    completed?: number
    started?: number
    total?: number
    totalPoints?: number
    earnedPoints?: number
  } | null
  collectionLog?: { obtained?: number; total?: number } | null
  combatAchievements?: ProfileCaTier[] | null
  achievementDiaries?: ProfileDiary[] | null
  updatedAt?: string | null
}

function toSummary(body: AccountResponse, name: string): ProfileSummary {
  return {
    username: body.username ?? name,
    exists: true,
    totalLevel: body.skills?.totalLevel ?? undefined,
    totalXp: body.skills?.totalXp ?? undefined,
    accountType: body.accountType?.name ?? undefined,
    clan: body.clan?.name ?? undefined,
    questsCompleted: body.quests?.completed ?? undefined,
    questsTotal: body.quests?.total ?? undefined,
    questsStarted: body.quests?.started ?? undefined,
    questPointsEarned: body.quests?.earnedPoints ?? undefined,
    questPointsTotal: body.quests?.totalPoints ?? undefined,
    collectionObtained: body.collectionLog?.obtained ?? undefined,
    collectionTotal: body.collectionLog?.total ?? undefined,
    updatedAt: body.updatedAt ?? undefined,
  }
}

/** The one honest message for both "no such account" and "never synced". */
function missError(err: unknown, name: string): string {
  const message = err instanceof Error ? err.message : String(err)
  // A 404 is the ordinary answer for "no such profile", not a failure worth
  // showing as one — most misses are a typo or an unsynced account.
  if (message.includes('404')) {
    return `No profile for “${name}”. They need the RuneProfile plugin and one sync.`
  }
  return message
}

export async function lookup(username: string): Promise<ProfileSummary> {
  const name = username.trim()
  if (!name) return { username: name, exists: false, error: 'Enter a username.' }

  try {
    // Shares the app-wide request queue. One global ceiling means a background
    // crawl can never push this over RuneProfile's limit either.
    const body = await client.getJson<AccountResponse>(
      `${API}/accounts/${encodeURIComponent(name)}`,
      'interactive'
    )
    return toSummary(body, name)
  } catch (err) {
    return { username: name, exists: false, error: missError(err, name) }
  }
}

// ── Full detail ─────────────────────────────────────────────────────────────

/**
 * Keyed by lowercased name, same as the hiscores. Five minutes matches the
 * hiscores cache and sits well above the API's own one-minute cache, so a
 * refresh spam costs the server nothing and a plugin sync still shows up
 * within a page or two of browsing. Misses are deliberately not cached: the
 * likeliest reason to look again after a miss is that the first sync just
 * happened, and that is exactly the moment a stale "no profile" would sting.
 */
const cache = new Map<string, ProfileData>()
const MAX_AGE_MS = 5 * 60 * 1000

export async function data(
  username: string,
  options?: { force?: boolean }
): Promise<ProfileData> {
  const name = username.trim()
  if (!name) return { username: name, exists: false, error: 'Enter a username.', fetchedAt: 0 }

  const key = name.toLowerCase()
  if (!options?.force) {
    const hit = cache.get(key)
    if (hit && Date.now() - hit.fetchedAt < MAX_AGE_MS) return hit
  }

  const base = `${API}/accounts/${encodeURIComponent(name)}`
  try {
    // Four requests through the shared queue, which spaces and dedupes them.
    // Well under the anonymous ceiling even if every one misses the cache.
    const [account, quests, caTasks, skills] = await Promise.all([
      client.getJson<AccountResponse>(base, 'interactive'),
      client.getJson<{ data?: ProfileQuest[] }>(`${base}/quests`, 'interactive'),
      client.getJson<{ totalPoints?: number; tierReached?: string | null; data?: ProfileCaTask[] }>(
        `${base}/combat-achievements/tasks`,
        'interactive'
      ),
      client.getJson<{ data?: ProfileSkill[] }>(`${base}/skills`, 'interactive'),
    ])

    const result: ProfileData = {
      username: account.username ?? name,
      exists: true,
      fetchedAt: Date.now(),
      summary: toSummary(account, name),
      quests: quests.data ?? [],
      caTasks: caTasks.data ?? [],
      caTotalPoints: caTasks.totalPoints ?? undefined,
      caTierReached: caTasks.tierReached ?? null,
      combatAchievements: account.combatAchievements ?? [],
      achievementDiaries: account.achievementDiaries ?? [],
      skills: skills.data ?? [],
    }
    cache.set(key, result)
    return result
  } catch (err) {
    return { username: name, exists: false, error: missError(err, name), fetchedAt: Date.now() }
  }
}
