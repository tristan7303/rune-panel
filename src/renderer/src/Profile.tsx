/**
 * RuneProfile: a native entry point in front of their UI.
 *
 * The profile itself is worth embedding — it is the reason for using
 * RuneProfile at all — but the way *in* should feel like the rest of this app,
 * remember who you look up, and not make you retype a username every time.
 *
 * The API call before loading the pane is not ceremony: a wrong username
 * otherwise loads a page that says so in someone else's voice, several seconds
 * later, with no obvious way back to trying again.
 */

import { useEffect, useRef, useState, type JSX } from 'react'
import type { ProfileSummary } from '@shared/ipc'
import { ToolPane } from './ToolPane'
import { usePrimaryInput } from './focus'
import { useStore } from './store'
import runeProfileLogo from './assets/runeprofile-logo.png'

const STORAGE_KEY = 'rp.profiles'
const MAX_SAVED = 8

export function Profile({ initial }: { initial?: string } = {}): JSX.Element {
  const [username, setUsername] = useState('')
  const [saved, setSaved] = useState<string[]>(() => loadSaved())
  const [viewing, setViewing] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = usePrimaryInput()

  // Arriving with a name — the Character page's "full profile" button — skips
  // the search view and goes straight to the pane. Once: this is a landing
  // instruction, not state, and going back to the search box must stick.
  const opened = useRef(false)
  useEffect(() => {
    if (opened.current || !initial?.trim()) return
    opened.current = true
    void open(initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial])

  useEffect(() => {
    if (viewing) setError(null)
  }, [viewing])

  // The name from settings goes in the box rather than opening straight into
  // the pane. Unlike the hiscores this loads a third-party page in an embedded
  // view, which is not something to start on your behalf — but it should not
  // need typing either.
  const rsn = useStore((s) => s.settings?.rsn)
  const seeded = useRef(false)
  useEffect(() => {
    if (seeded.current || !rsn?.trim()) return
    seeded.current = true
    setUsername((current) => (current ? current : rsn))
  }, [rsn])

  const open = async (name: string): Promise<void> => {
    const trimmed = name.trim()
    if (!trimmed) return

    setChecking(true)
    setError(null)
    let summary: ProfileSummary
    try {
      summary = await window.rp.lookupProfile(trimmed)
    } finally {
      setChecking(false)
    }

    if (!summary.exists) {
      setError(summary.error ?? `No profile for “${trimmed}”.`)
      return
    }

    // Store the API's spelling, not the typed one — it carries the account's
    // real capitalisation.
    const canonical = summary.username
    setSaved((prev) => {
      const next = [canonical, ...prev.filter((p) => p.toLowerCase() !== canonical.toLowerCase())]
      const capped = next.slice(0, MAX_SAVED)
      persist(capped)
      return capped
    })
    setViewing(canonical)
  }

  const forget = (name: string): void => {
    setSaved((prev) => {
      const next = prev.filter((p) => p !== name)
      persist(next)
      return next
    })
  }

  if (viewing) {
    return (
      <div className="tool-host">
        <div className="tool-bar">
          <button className="btn" onClick={() => setViewing(null)}>
            ← Look up someone else
          </button>
          <span className="tool-bar-title">{viewing}</span>
        </div>
        <ToolPane id="profile" arg={viewing} />
      </div>
    )
  }

  return (
    <div className="profile-search">
      <div className="profile-hero">
        {/* Their mark, not a generic silhouette — the same treatment the GE
            Tracker landing gives its logo. Theirs is a square avatar rather
            than a wordmark, so the name stays as text beneath it. */}
        <img src={runeProfileLogo} alt="" draggable={false} />
        <h1>RuneProfile</h1>
        <p>
          Skills, quests, achievement diaries, combat achievements and the full collection log.
          Requires the RuneProfile RuneLite plugin and one sync.
        </p>
      </div>

      <form
        className="profile-form"
        onSubmit={(e) => {
          e.preventDefault()
          void open(username)
        }}
      >
        <input
          // Registered only while the search view is up. Once the pane is
          // showing a profile there is nothing here to focus, which is what
          // stops the route change from pulling focus off the pane.
          ref={inputRef}
          type="text"
          className="profile-input"
          placeholder="Username"
          spellCheck={false}
          autoComplete="off"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <button type="submit" className="btn" disabled={checking || !username.trim()}>
          {checking ? 'Checking…' : 'Look up'}
        </button>
      </form>

      {error && <p className="profile-error">{error}</p>}

      {saved.length > 0 && (
        <div className="profile-saved">
          <h2>Recent</h2>
          <ul>
            {saved.map((name) => (
              <li key={name}>
                <button className="profile-chip" onClick={() => void open(name)}>
                  {name}
                </button>
                <button
                  className="profile-forget"
                  title={`Forget ${name}`}
                  aria-label={`Forget ${name}`}
                  onClick={() => forget(name)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/**
 * Recent lookups live in localStorage rather than the database.
 *
 * They are renderer-only convenience state that nothing in main reads, and a
 * schema migration for a list of eight strings would be the wrong trade.
 */
function loadSaved(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

function persist(names: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(names))
  } catch {
    /* storage disabled or full; recents are not worth failing over */
  }
}
