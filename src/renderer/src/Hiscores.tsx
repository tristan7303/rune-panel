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

import { useEffect, useRef, useState, type JSX } from 'react'
import type { AccountMode, Hiscores as Data, HiscoreActivity, HiscoreSkill } from '@shared/ipc'
import { shortNumber } from '@shared/xp'
import { TrophyIcon, SearchIcon } from './icons'
import { usePrimaryInput } from './focus'
import { useStore } from './store'
import { activityIcon, skillIcon } from './hiscoreIcons'

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
  const inputRef = usePrimaryInput()

  const look = async (name: string, as: 'primary' | 'compare', mode?: AccountMode): Promise<void> => {
    const trimmed = name.trim()
    if (!trimmed) return
    setBusy(true)
    setError(null)
    try {
      const data = await window.rp.hiscores(trimmed, mode)
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

  // Open on your own account when settings know who you are. The search box is
  // left empty rather than prefilled, so looking someone else up is still just
  // typing — the name in settings answers "show me mine", not "search for this".
  const rsn = useStore((s) => s.settings?.rsn)
  const opened = useRef(false)
  useEffect(() => {
    if (opened.current || primary || !rsn?.trim()) return
    opened.current = true
    // The ref, not the dependency list, is what stops this running twice —
    // `look` is a new function every render and would defeat any guard built
    // out of dependencies.
    void look(rsn, 'primary')
  }, [rsn, primary])

  return (
    <div className="hiscores">
      {!primary && (
        <div className="ge-hero">
          <TrophyIcon />
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
            ref={inputRef}
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
            <AccountHead
              data={primary}
              onClear={() => setPrimary(null)}
              onMode={(mode) => void look(primary.name, 'primary', mode)}
            />
            {compare && <AccountHead data={compare} onClear={() => setCompare(null)} compare />}
          </div>
          <div className="hs-body">
            <SkillTable primary={primary} compare={compare} />
            <Activities data={primary} />
          </div>
        </>
      )}
    </div>
  )
}

function AccountHead({
  data,
  onClear,
  onMode,
  compare,
}: {
  data: Data
  onClear: () => void
  onMode?: (mode: AccountMode) => void
  compare?: boolean
}): JSX.Element {
  return (
    <div className={`hs-head ${compare ? 'is-compare' : ''}`}>
      <div className="hs-head-name">
        <strong>{data.name}</strong>
        <span className="chip">{MODE_LABEL[data.mode] ?? data.mode}</span>
        {/* Other boards this name is on. Only ever shown for an account that
            has changed type — a dead hardcore ironman, a de-ironed main — where
            the board above is the live one and these are the frozen history.
            Offered rather than hidden, because the old stats are the reason
            some people look themselves up at all. */}
        {onMode &&
          data.alsoOn?.map((mode) => (
            <button
              key={mode}
              className="chip is-alt"
              title={`Show the ${MODE_LABEL[mode].toLowerCase()} board — no longer updating`}
              onClick={() => onMode(mode)}
            >
              {MODE_LABEL[mode]}
            </button>
          ))}
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
          <th className="hs-level">Level</th>
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
  // 99 is the ceiling the hiscores report; anything past it lives in the
  // virtual level. Marking the row is the same idea as the gold Exchange row on
  // an item page — one figure on the page is the one you came to look at.
  const maxed = skill.level >= 99

  return (
    <tr className={maxed ? 'is-maxed' : ''}>
      <td className="hs-skill">
        <img className="hs-skill-icon" src={skillIcon(skill.name)} alt="" draggable={false} />
        {skill.name}
      </td>
      <td className="hs-level">
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
      {/* The flex lives on a wrapper, not on the cell. A `display: flex` td
          stops being a table-cell, so its bottom border no longer sits on the
          row's baseline with the others — which is why this column's rule read
          as a pixel out of line all the way down the table. */}
      <td className="hs-bar-cell">
        <div className="hs-bar-wrap">
          <span className="hs-bar" title={`${Math.round(skill.progress.fraction * 100)}% to level`}>
            <span className="hs-bar-fill" style={{ width: `${skill.progress.fraction * 100}%` }} />
          </span>
          <span className="hs-to-next">
            {skill.progress.toNextLevel !== null ? shortNumber(skill.progress.toNextLevel) : 'max'}
          </span>
        </div>
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

/**
 * Kill counts, clues and everything else the hiscores track.
 *
 * The API returns all 91 rows in a fixed order whose id ranges are the only
 * grouping available — there is no category field — so the boundaries below are
 * read off that order rather than inferred from names, which change.
 */
const CLUE_IDS = { from: 7, to: 13 }
const BOSS_FROM = 20

function group(
  activities: HiscoreActivity[]
): Array<{ title: string; unit: string; rows: HiscoreActivity[] }> {
  const clues = activities.filter((a) => a.id >= CLUE_IDS.from && a.id <= CLUE_IDS.to)
  // Alphabetical, so a boss can be found by name in a grid of pictures. The
  // API's own order is roughly alphabetical already but not reliably —
  // "Phosani's Nightmare" sits under "Nightmare", and the newest additions are
  // wherever they were appended.
  const bosses = activities
    .filter((a) => a.id >= BOSS_FROM)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
  const other = activities.filter(
    (a) => a.id < CLUE_IDS.from || (a.id > CLUE_IDS.to && a.id < BOSS_FROM)
  )

  return [
    // Clues and the rest keep the API's order, which for clues is the
    // difficulty ladder — alphabetising that would be actively worse.
    //
    // `unit` is what the number means, which a grid of bare figures cannot say
    // for itself: the same column holds kill counts, completed clues and
    // league points.
    { title: 'Bosses', unit: 'kills', rows: bosses },
    { title: 'Clue scrolls', unit: 'completed', rows: clues },
    { title: 'Other', unit: 'score', rows: other },
  ].filter((g) => g.rows.length > 0)
}

/**
 * A grid of artwork rather than a list of names.
 *
 * Seventy-one bosses as text is a wall nobody reads. As pictures it is
 * scannable, and the absences carry as much information as the entries — an
 * empty slot is a boss you have never killed, which a filtered list simply
 * would not have shown you.
 *
 * Three across, filling left to right, so alphabetical order reads like a page.
 */
function Activities({ data }: { data: Data }): JSX.Element {
  const groups = group(data.activities)
  const [tip, setTip] = useState<Tip | null>(null)

  return (
    <aside className="hs-activities" onMouseLeave={() => setTip(null)}>
      {groups.map((g) => (
        <section key={g.title}>
          <h2>{g.title}</h2>
          <div className="hs-grid">
            {g.rows.map((a) => (
              <ActivityCell key={a.id} activity={a} unit={g.unit} onHover={setTip} />
            ))}
          </div>
        </section>
      ))}
      {tip && <ActivityTip tip={tip} />}
    </aside>
  )
}

interface Tip {
  activity: HiscoreActivity
  unit: string
  /** The cell's viewport rectangle, to anchor against. */
  anchor: DOMRect
}

function ActivityCell({
  activity,
  unit,
  onHover,
}: {
  activity: HiscoreActivity
  unit: string
  onHover: (tip: Tip | null) => void
}): JSX.Element {
  // The hiscores use -1 for both fields on anything the account has not done.
  const done = activity.score > 0

  return (
    <div
      className={`hs-cell ${done ? '' : 'is-empty'}`}
      // No `title`. The native tooltip cannot be styled at all, waits half a
      // second before appearing, and renders in the OS font over a grid where
      // the label is the only way to know what you are looking at.
      aria-label={activity.name}
      onMouseEnter={(e) =>
        onHover({ activity, unit, anchor: e.currentTarget.getBoundingClientRect() })
      }
      onMouseLeave={() => onHover(null)}
    >
      <img className="hs-cell-img" src={activityIcon(activity.name)} alt="" draggable={false} />
      <span className="hs-cell-score">{done ? activity.score.toLocaleString() : '--'}</span>
    </div>
  )
}

/** How wide the tooltip is allowed to get. Also what the clamp below budgets for. */
const TIP_WIDTH = 210
const TIP_GAP = 8

/**
 * The hover card for one cell.
 *
 * Fixed rather than absolute, so it is not clipped by the scrolling content
 * area — a cell in the last row would otherwise have its tooltip cut in half by
 * the edge of the pane.
 *
 * Position is clamped rather than measured. The card has a fixed maximum width,
 * so where it will land can be worked out before it is laid out, which avoids a
 * measure-then-reposition pass that shows one frame in the wrong place.
 */
function ActivityTip({ tip }: { tip: Tip }): JSX.Element {
  const { activity, unit, anchor } = tip
  const done = activity.score > 0

  // Left-aligned with the cell, pulled back if that would run off the right.
  const left = Math.max(TIP_GAP, Math.min(anchor.left, window.innerWidth - TIP_WIDTH - TIP_GAP))
  // Above, unless there is not room — the top rows of the grid sit near the
  // title bar.
  const below = anchor.top < 96
  const top = below ? anchor.bottom + TIP_GAP : anchor.top - TIP_GAP

  return (
    <div
      className="hs-tip"
      role="tooltip"
      style={{ left, top, transform: below ? undefined : 'translateY(-100%)' }}
    >
      <strong>{activity.name}</strong>
      {done ? (
        <>
          <span className="hs-tip-score">
            {activity.score.toLocaleString()} <em>{unit}</em>
          </span>
          <span className="hs-tip-rank">
            {activity.rank > 0 ? `Rank ${activity.rank.toLocaleString()}` : 'Unranked'}
          </span>
        </>
      ) : (
        <span className="hs-tip-rank">None recorded</span>
      )}
    </div>
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
