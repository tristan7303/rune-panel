/**
 * RuneProfile account lookup.
 *
 * A supporting role only — the profile itself is their website, shown in the
 * pane. This exists so the native search page can tell you a username is wrong
 * *before* loading a page that would just say so less clearly, and so saved
 * accounts can show something more useful than a bare string.
 *
 * Anonymous access is 30 requests a minute, which is far more than a search box
 * needs; an optional API key raises it to 120 and is not worth asking for.
 */

import * as client from '../wiki/client'
import type { ProfileSummary } from '../../shared/ipc'

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
  quests?: { completed?: number; total?: number } | null
  collectionLog?: { obtained?: number; total?: number } | null
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

    return {
      username: body.username ?? name,
      exists: true,
      totalLevel: body.skills?.totalLevel ?? undefined,
      totalXp: body.skills?.totalXp ?? undefined,
      accountType: body.accountType?.name ?? undefined,
      clan: body.clan?.name ?? undefined,
      questsCompleted: body.quests?.completed ?? undefined,
      questsTotal: body.quests?.total ?? undefined,
      collectionObtained: body.collectionLog?.obtained ?? undefined,
      collectionTotal: body.collectionLog?.total ?? undefined,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // A 404 is the ordinary answer for "no such profile", not a failure worth
    // showing as one — most misses are a typo or an unsynced account.
    if (message.includes('404')) {
      return {
        username: name,
        exists: false,
        error: `No profile for “${name}”. They need the RuneProfile plugin and one sync.`,
      }
    }
    return { username: name, exists: false, error: message }
  }
}
