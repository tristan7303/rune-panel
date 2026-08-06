/**
 * Hiscores.
 *
 * A lookup, the skill table, and a compare column. Compare is the reason this
 * exists rather than a link to the official page: the interesting question is
 * rarely "what are my stats" — it is "how far behind am I", and answering that
 * on the website means two tabs and mental arithmetic.
 *
 * Saved accounts live in localStorage. They are renderer-only convenience and a
 * schema migration for a list of names would be the wrong trade.
 */

import { useState, type JSX } from 'react'
import type { Hiscores as Data, HiscoreSkill } from '@shared/ipc'
import { shortNumber } from '@shared/xp'
import { ChartIcon, SearchIcon } from './icons'

const STORAGE_KEY = 'rp.hiscores'
const MAX_SAVED = 10

const MODE_LABEL: Record<string, string> = {
  main: 'Main',
  ironman: 'Ironman',
  hardcore: 'Hardcore ironman',
  ultimate: 'Ultimate ironman',
}

export function Hiscores(): JSX.Element {
  const [query, setQuery] = useState('')
  const [primary, setPrimary] = useState<Data | null>(null)
  const [compare, setCompare] = useState<Data | null>(null)
  const [saved, setSaved] = useState<string[]>(() => loadSaved())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const look = async (name: string, as: 'primary' | 'compare'): Promise<void> => {
    const trimmed = name.trim()
    if (!trimmed) return
    setBusy(true)
    setError(null)
    try {
      const data = await window.rp.hiscores(trimmed)
      if (as === 'primary') setPrimary(data)
      else setCompare(data)
      setQuery('')
      setSaved((prev) => {
        const next = [data.name, ...prev.filter((p) => p.toLowerCase() !== data.name.toLowerCase())]
        const capped = next.slice(0, MAX_SAVED)
        persist(capped)
        return capped
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="hiscores">
      {!primary && (
        <div className="ge-hero">
          <ChartIcon />
          <h1>Hiscores</h1>
          <p>
            Look up any account. Rune Panel works out which board it is on, so ironman accounts are
            found without picking a mode.
          </p>
        </div>
      )}

      <form
        className="hs-form"
        onSubmit={(e) => {
          e.preventDefault()
          void look(query, 'primary')
        }}
      >
        <div className="search-field">
          <SearchIcon />
          <input
            type="text"
            className="search-input"
            placeholder="Username"
            spellCheck={false}
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button type="submit" className="btn" disabled={busy || !query.trim()}>
          {busy ? 'Looking up…' : 'Look up'}
        </button>
        {primary && (
          <button
            type="button"
            className="btn"
            disabled={busy || !query.trim()}
            onClick={() => void look(query, 'compare')}
            title="Show this account beside the current one"
          >
            Compare
          </button>
        )}
      </form>

      {error && <p className="profile-error">{error}</p>}

      {saved.length > 0 && !primary && (
        <div className="profile-saved">
          <h2>Recent</h2>
          <ul>
            {saved.map((name) => (
              <li key={name}>
                <button className="profile-chip" onClick={() => void look(name, 'primary')}>
                  {name}
                </button>
                <button
                  className="profile-forget"
                  title={`Forget ${name}`}
                  aria-label={`Forget ${name}`}
                  onClick={() =>
                    setSaved((prev) => {
                      const next = prev.filter((p) => p !== name)
                      persist(next)
                      return next
                    })
                  }
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {primary && (
        <>
          <div className="hs-heads">
            <AccountHead data={primary} onClear={() => setPrimary(null)} />
            {compare && <AccountHead data={compare} onClear={() => setCompare(null)} compare />}
          </div>
          <SkillTable primary={primary} compare={compare} />
        </>
      )}
    </div>
  )
}

function AccountHead({
  data,
  onClear,
  compare,
}: {
  data: Data
  onClear: () => void
  compare?: boolean
}): JSX.Element {
  return (
    <div className={`hs-head ${compare ? 'is-compare' : ''}`}>
      <div className="hs-head-name">
        <strong>{data.name}</strong>
        <span className="chip">{MODE_LABEL[data.mode] ?? data.mode}</span>
      </div>
      <div className="hs-head-stats">
        <span>
          Total level <b>{data.totalLevel.toLocaleString()}</b>
        </span>
        <span>
          Total XP <b>{shortNumber(data.totalXp)}</b>
        </span>
        <span>
          Rank <b>{data.overallRank > 0 ? data.overallRank.toLocaleString() : 'unranked'}</b>
        </span>
      </div>
      <button className="link-btn" onClick={onClear}>
        {compare ? 'remove' : 'clear'}
      </button>
    </div>
  )
}

/**
 * The skill table.
 *
 * The bar is the point: a level tells you where someone is, the bar tells you
 * how close the next one is, which is the thing a level alone hides. With a
 * comparison loaded the difference column carries a sign, because "+12" and
 * "-12" answer opposite questions and the raw numbers do not.
 */
function SkillTable({ primary, compare }: { primary: Data; compare: Data | null }): JSX.Element {
  const other = new Map(compare?.skills.map((s) => [s.name, s]) ?? [])

  return (
    <table className="hs-table">
      <thead>
        <tr>
          <th>Skill</th>
          <th className="hs-num">Level</th>
          <th className="hs-num">XP</th>
          <th className="hs-num">Rank</th>
          <th className="hs-bar-head">To next</th>
          {compare && <th className="hs-num">{compare.name}</th>}
          {compare && <th className="hs-num">Diff</th>}
        </tr>
      </thead>
      <tbody>
        {primary.skills.map((skill) => (
          <SkillRow key={skill.name} skill={skill} against={other.get(skill.name) ?? null} />
        ))}
      </tbody>
    </table>
  )
}

function SkillRow({
  skill,
  against,
}: {
  skill: HiscoreSkill
  against: HiscoreSkill | null
}): JSX.Element {
  const diff = against ? skill.level - against.level : 0

  return (
    <tr>
      <td className="hs-skill">{skill.name}</td>
      <td className="hs-num">
        {skill.level}
        {skill.progress.virtualLevel > skill.level && (
          <span className="hs-virtual" title="Virtual level past 99">
            {' '}
            ({skill.progress.virtualLevel})
          </span>
        )}
      </td>
      <td className="hs-num">{shortNumber(skill.xp)}</td>
      <td className="hs-num hs-rank">{skill.rank > 0 ? skill.rank.toLocaleString() : '—'}</td>
      <td className="hs-bar-cell">
        <span className="hs-bar" title={`${Math.round(skill.progress.fraction * 100)}% to level`}>
          <span className="hs-bar-fill" style={{ width: `${skill.progress.fraction * 100}%` }} />
        </span>
        <span className="hs-to-next">
          {skill.progress.toNextLevel !== null ? shortNumber(skill.progress.toNextLevel) : 'max'}
        </span>
      </td>
      {against && <td className="hs-num">{against.level}</td>}
      {against && (
        <td className={`hs-num hs-diff ${diff > 0 ? 'is-up' : diff < 0 ? 'is-down' : ''}`}>
          {diff > 0 ? `+${diff}` : diff < 0 ? String(diff) : '—'}
        </td>
      )}
    </tr>
  )
}

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
    /* storage disabled; recents are not worth failing over */
  }
}
