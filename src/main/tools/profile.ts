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

interface AccountResponse {
  username?: string
  skills?: Array<{ name: string; level: number }>
  // The API has grown over time; anything not read here is deliberately ignored
  // rather than typed, since none of it drives a decision.
  [key: string]: unknown
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

    const skills = body.skills ?? []
    // Overall is reported as a skill alongside the rest; summing every entry
    // would double-count it.
    const total = skills
      .filter((s) => s.name.toLowerCase() !== 'overall')
      .reduce((sum, s) => sum + (s.level || 0), 0)

    return {
      username: body.username ?? name,
      exists: true,
      totalLevel: total > 0 ? total : undefined,
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
