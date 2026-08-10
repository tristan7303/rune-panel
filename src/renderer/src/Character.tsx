/**
 * The Character page.
 *
 * Your own account's progress, drawn natively: quests, combat achievements,
 * achievement diaries, skills and the collection-log count, all from the same
 * RuneProfile data that colors requirements on articles. The embedded
 * RuneProfile pane remains the deep view — it has the full collection log and
 * their presentation — so this page summarises and hands off rather than
 * competing.
 *
 * No search box. The page answers "how is my account doing", and my is the
 * name in settings; looking up someone else is what the RuneProfile view is
 * for. That keeps this page honest about whose data drives the article marks.
 */

import { type JSX } from 'react'
import { shortNumber } from '@shared/xp'
import type { ProfileData, ProfileQuest } from '@shared/ipc'
import { useStore } from './store'
import { useNav } from './nav'
import { useProfile } from './runeprofile'
import { UserIcon } from './icons'
import { skillIcon } from './hiscoreIcons'

export function Character(): JSX.Element {
  const rsn = useStore((s) => s.settings?.rsn)
  const push = useNav((s) => s.push)
  const data = useProfile((s) => s.data)
  const loading = useProfile((s) => s.loading)
  const error = useProfile((s) => s.error)

  if (!rsn?.trim()) {
    return (
      <div className="character">
        <div className="ge-hero">
          <UserIcon />
          <h1>Character</h1>
          <p>
            Quests, combat achievements, diaries and skills for your own account — and the same
            data colors requirements on wiki pages as you read them.
          </p>
          <button className="btn" onClick={() => push({ kind: 'settings' })}>
            Set your RuneScape name in Settings
          </button>
        </div>
      </div>
    )
  }

  if (loading && !data) {
    return (
      <div className="character">
        <p className="character-note">Looking up {rsn}…</p>
      </div>
    )
  }

  if (!data || !data.exists) {
    return (
      <div className="character">
        <div className="ge-hero">
          <UserIcon />
          <h1>{rsn}</h1>
          {/* A miss is almost always an unsynced account, not a wrong name —
              the name already worked against the hiscores to get here. */}
          <p>
            {data?.error ?? error ?? 'Nothing here yet.'} RuneProfile only knows accounts running
            its RuneLite plugin; install it, log in once, and this page fills in.
          </p>
          <div className="character-actions">
            <button
              className="btn"
              onClick={() => useProfile.getState().load(rsn, { force: true })}
              disabled={loading}
            >
              {loading ? 'Checking…' : 'Check again'}
            </button>
            <button className="btn" onClick={() => push({ kind: 'tool', id: 'profile' })}>
              Browse RuneProfile
            </button>
          </div>
        </div>
      </div>
    )
  }

  return <CharacterBody data={data} loading={loading} rsn={rsn} />
}

function CharacterBody({
  data,
  loading,
  rsn,
}: {
  data: ProfileData
  loading: boolean
  rsn: string
}): JSX.Element {
  const push = useNav((s) => s.push)
  const s = data.summary

  return (
    <div className="character">
      <header className="character-head">
        <div className="character-id">
          <strong>{data.username}</strong>
          {s?.accountType && <span className="chip">{s.accountType}</span>}
          {s?.clan && <span className="chip is-alt">{s.clan}</span>}
          {s?.updatedAt && <span className="character-synced">synced {ago(s.updatedAt)}</span>}
        </div>
        <div className="character-actions">
          <button
            className="btn"
            onClick={() => useProfile.getState().load(rsn, { force: true })}
            disabled={loading}
            title="Fetch fresh data from RuneProfile"
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button
            className="btn"
            onClick={() => push({ kind: 'tool', id: 'profile', arg: data.username })}
            title="Open the full profile on runeprofile.com"
          >
            Full profile
          </button>
        </div>
      </header>

      <div className="character-tiles">
        <Tile label="Total level" value={s?.totalLevel?.toLocaleString() ?? '—'} />
        <Tile label="Total XP" value={s?.totalXp !== undefined ? shortNumber(s.totalXp) : '—'} />
        <Tile
          label="Quest points"
          value={
            s?.questPointsEarned !== undefined ? `${s.questPointsEarned} / ${s.questPointsTotal}` : '—'
          }
        />
        <Tile
          label="Collection log"
          value={
            s?.collectionObtained !== undefined
              ? `${s.collectionObtained.toLocaleString()} / ${s.collectionTotal?.toLocaleString()}`
              : '—'
          }
        />
        <Tile
          label="CA points"
          value={data.caTotalPoints !== undefined ? String(data.caTotalPoints) : '—'}
          hint={data.caTierReached ? `${data.caTierReached} tier` : undefined}
        />
      </div>

      <div className="character-panels">
        <Quests quests={data.quests ?? []} />
        <section className="character-panel">
          <h2>Combat achievements</h2>
          {(data.combatAchievements ?? []).map((tier) => (
            <Bar key={tier.id} label={tier.name} done={tier.completed} total={tier.total} />
          ))}
        </section>
        <section className="character-panel">
          <h2>Achievement diaries</h2>
          {(data.achievementDiaries ?? []).map((area) => (
            <Bar key={area.areaId} label={area.area} done={area.completed} total={area.total} />
          ))}
        </section>
        <section className="character-panel character-skills">
          <h2>Skills</h2>
          <div className="character-skill-grid">
            {(data.skills ?? []).map((skill) => (
              <div
                key={skill.name}
                className={`character-skill ${skill.level >= 99 ? 'is-maxed' : ''}`}
                title={
                  skill.xpToNextLevel !== null
                    ? `${skill.name} — ${shortNumber(skill.xp)} XP, ${shortNumber(skill.xpToNextLevel)} to next`
                    : `${skill.name} — ${shortNumber(skill.xp)} XP`
                }
              >
                <img src={skillIcon(skill.name)} alt="" draggable={false} />
                <span>
                  {skill.level}
                  {skill.virtualLevel > skill.level && (
                    <em className="hs-virtual"> ({skill.virtualLevel})</em>
                  )}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }): JSX.Element {
  return (
    <div className="character-tile">
      <span className="character-tile-value">{value}</span>
      <span className="character-tile-label">{hint ? `${label} · ${hint}` : label}</span>
    </div>
  )
}

/**
 * The quest panel: one bar for the whole log, then the free/members/miniquest
 * split. In-progress gets its own segment rather than folding into either
 * side — a half-done quest is the one you most want reminding about.
 */
function Quests({ quests }: { quests: ProfileQuest[] }): JSX.Element {
  const groups: Array<{ label: string; rows: ProfileQuest[] }> = [
    { label: 'Free', rows: quests.filter((q) => q.type === 'free') },
    { label: 'Members', rows: quests.filter((q) => q.type === 'members') },
    { label: 'Miniquests', rows: quests.filter((q) => q.type === 'mini') },
  ]
  const done = quests.filter((q) => q.state === 'finished').length
  const doing = quests.filter((q) => q.state === 'in_progress').length

  return (
    <section className="character-panel">
      <h2>Quests</h2>
      <div className="character-quest-total">
        <span className="char-bar">
          <span className="char-bar-fill" style={{ width: pct(done, quests.length) }} />
          <span className="char-bar-fill is-progress" style={{ width: pct(doing, quests.length) }} />
        </span>
        <span className="character-quest-count">
          <b>{done}</b> / {quests.length}
          {doing > 0 && <em> · {doing} in progress</em>}
        </span>
      </div>
      {groups
        .filter((g) => g.rows.length > 0)
        .map((g) => (
          <Bar
            key={g.label}
            label={g.label}
            done={g.rows.filter((q) => q.state === 'finished').length}
            total={g.rows.length}
          />
        ))}
    </section>
  )
}

function Bar({ label, done, total }: { label: string; done: number; total: number }): JSX.Element {
  return (
    <div className={`character-bar-row ${done >= total && total > 0 ? 'is-complete' : ''}`}>
      <span className="character-bar-label">{label}</span>
      <span className="char-bar">
        <span className="char-bar-fill" style={{ width: pct(done, total) }} />
      </span>
      <span className="character-bar-count">
        {done} / {total}
      </span>
    </div>
  )
}

function pct(part: number, whole: number): string {
  return whole > 0 ? `${(part / whole) * 100}%` : '0%'
}

/**
 * "2026-08-10 12:57:39.620623" as the API writes it, read as UTC.
 *
 * The string carries no zone. Treating it as local would show "in 7 hours" to
 * anyone west of the server, which reads as broken; UTC is what API timestamps
 * mean unless they say otherwise, and a small error in an "ago" is invisible
 * anyway once the answer is "3 days".
 */
function ago(updatedAt: string): string {
  const parsed = Date.parse(updatedAt.replace(' ', 'T').replace(/(\.\d+)?$/, 'Z'))
  if (Number.isNaN(parsed)) return updatedAt
  const minutes = Math.max(0, Math.round((Date.now() - parsed) / 60_000))
  if (minutes < 2) return 'just now'
  if (minutes < 60) return `${minutes} minutes ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  return `${days} days ago`
}
