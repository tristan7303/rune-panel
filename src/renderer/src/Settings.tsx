/**
 * Settings.
 *
 * A view rather than a modal sheet — the window is already a transient overlay,
 * and stacking a second layer of dismissal on top of it earns nothing.
 */

import { useEffect, useState, type JSX } from 'react'
import type {
  AccountMode,
  CrawlState,
  KeywordAlias,
  ScaleDirection,
  TitleIndexState,
  UpdateStatus,
} from '@shared/ipc'
import { useStore } from './store'
import { usePlayer } from './player'
import { capture, specParts, type BindScope } from './keycapture'

/**
 * The tabs, in the order they are offered.
 *
 * Grouped by what you came here to change rather than by which part of the code
 * owns the setting. "Reading" is everything that alters an article on the page
 * — drop rates, columns, which price service a button opens — because that is
 * one decision from the reader's side even though it crosses three modules.
 * About is last because it is the only one you visit deliberately rather than
 * on the way to something.
 */
const TABS = ['General', 'Appearance', 'Reading', 'Search', 'About'] as const
type Tab = (typeof TABS)[number]

export function SettingsView(): JSX.Element {
  const settings = useStore((s) => s.settings)
  const patch = useStore((s) => s.patchSettings)
  const [tab, setTab] = useState<Tab>('General')

  if (!settings) return <div className="placeholder">Loading…</div>

  return (
    <div className="settings">
      <h1>Settings</h1>

      <nav className="settings-tabs" role="tablist" aria-label="Settings sections">
        {TABS.map((name) => (
          <button
            key={name}
            role="tab"
            aria-selected={name === tab}
            className={`settings-tab ${name === tab ? 'is-active' : ''}`}
            onClick={() => setTab(name)}
          >
            {name}
          </button>
        ))}
      </nav>

      {tab === 'General' && (
        <>
      {/* Keybinds first, and together. The global one is genuinely different
          from the other two — it is registered with Windows and can be lost to
          another program — so it says so rather than sitting unmarked beside
          shortcuts that always work. */}
      <Group title="Keyboard">
        <Field
          label="Open and close"
          hint="Works anywhere in Windows, including over a game. Registered with the OS, so another program holding the same combination wins it — if the shortcut stops working, something else has claimed it."
        >
          <KeyBind
            value={settings.hotkey}
            scope="global"
            onChange={(hotkey) => patch({ hotkey })}
          />
        </Field>

        <Field
          label="Search the wiki"
          hint="Focuses the search box in the title bar. Ctrl+K always works too."
        >
          <KeyBind
            value={settings.searchKey}
            scope="app"
            onChange={(searchKey) => patch({ searchKey })}
          />
        </Field>

        <Field
          label="Prices"
          hint={
            settings.geTrackerReplacesGe
              ? 'Opens GE Tracker with the item box focused, or just focuses it if you are already there.'
              : 'Opens the Grand Exchange with the item box focused, or just focuses it if you are already there.'
          }
        >
          <KeyBind value={settings.geKey} scope="app" onChange={(geKey) => patch({ geKey })} />
        </Field>
      </Group>

      <Group title="Window">
        <Field
          label="Start with Windows"
          hint="Launches hidden when you log in, so the hotkey works without remembering to open anything first. It waits in the tray; nothing appears until you summon it. Only applies to an installed build."
        >
          <Switch
            checked={settings.startOnLogin}
            onChange={(startOnLogin) => patch({ startOnLogin })}
            label="Start with Windows"
          />
        </Field>


        <Field
          label="Stay on top"
        hint="Keeps the window above other windows while it is open, including a borderless-fullscreen game client. On by default — that is what it is for."
      >
        <Switch
          checked={settings.alwaysOnTop}
          onChange={(alwaysOnTop) => patch({ alwaysOnTop })}
          label="Stay on top"
        />
      </Field>

        <Field
          label="Close when it loses focus"
          hint="Off by default. You will click into the game while reading, and vanishing mid-sentence is worse than pressing Escape."
        >
          <Switch
            checked={settings.hideOnBlur}
            onChange={(hideOnBlur) => patch({ hideOnBlur })}
            label="Close when it loses focus"
          />
        </Field>
      </Group>

      <Group title="Account">
        <RsnField />
      </Group>
        </>
      )}

      {tab === 'Appearance' && (
        <>
      <Group title="Appearance">
        <Field
          label="Acrylic backdrop"
          hint="Frosts the window against whatever is behind it. Windows 11 only, and purely cosmetic — the interface is designed to look right without it."
        >
          <Switch
            checked={settings.acrylic}
            onChange={(acrylic) => patch({ acrylic })}
            label="Acrylic backdrop"
          />
        </Field>

        <Field
          label="Interface size"
          hint="Scales the whole interface — text, icons and spacing together — not just the type. Ctrl+scroll anywhere in the app does the same thing."
        >
          <ScaleStepper value={settings.uiScale} onChange={(uiScale) => patch({ uiScale })} />
        </Field>

        <Field
          label="Reduce motion"
          hint="Replaces the open and close animation with a quick fade. Forced on anyway if Windows is set to minimise animations."
        >
          <Switch
            checked={settings.reduceMotion}
            onChange={(reduceMotion) => patch({ reduceMotion })}
            label="Reduce motion"
          />
        </Field>

        <Field
          label="Smooth section jumps"
          hint="Clicking an entry in a page's Contents box travels down to that section instead of arriving there, so you can see which way the page moved and how far. It lands on the heading either way. Separate from Reduce motion, which only governs the window itself."
        >
          <Switch
            checked={settings.smoothSectionJumps}
            onChange={(smoothSectionJumps) => patch({ smoothSectionJumps })}
            label="Smooth section jumps"
          />
        </Field>
      </Group>
        </>
      )}

      {tab === 'Reading' && (
        <>
      <Group title="Prices">
        <Field
          label="Replace Wiki prices with GE Tracker"
          hint="One switch for all of it: the rail shows GE Tracker instead of the Grand Exchange, the shortcut goes there, and every Price history button opens the item on their site. Turn it off to get the built-in chart back — offline, instant, and drawn in your theme."
        >
          <Switch
            checked={settings.geTrackerReplacesGe}
            onChange={(geTrackerReplacesGe) => patch({ geTrackerReplacesGe })}
            label="Replace Wiki prices with GE Tracker"
          />
        </Field>
      </Group>

      <Group title="Drop rates">
        <Field
          label="Show item drop rate in title"
          hint="Puts an item's drop chances beside its name, coloured by rarity, as 1 in N. Click one to open that source's drop table. More than three sources collapse to a single chip."
        >
          <Switch
            checked={settings.dropRateInTitle}
            onChange={(dropRateInTitle) => patch({ dropRateInTitle })}
            label="Show item drop rate in title"
          />
        </Field>

        {settings.dropRateInTitle && (
          <Field
            label="Order those badges by"
            hint="Which end of the ramp to start from when an item has more than one source."
          >
            <select
              className="settings-select"
              value={settings.dropRateOrder}
              onChange={(e) => patch({ dropRateOrder: e.target.value as 'common' | 'rare' })}
            >
              <option value="common">Most common first</option>
              <option value="rare">Rarest first</option>
            </select>
          </Field>
        )}

        <Field
          label="Always show rates as 1 in N"
          hint="Rewrites drop tables too, so 2/69 reads 1/34.5 and 5/150 reads 1/30. Off by default — the wiki's own wording says how the drop is implemented, and hovering a cell always shows it."
        >
          <Switch
            checked={settings.normaliseDropRates}
            onChange={(normaliseDropRates) => patch({ normaliseDropRates })}
            label="Always show rates as 1 in N"
          />
        </Field>

        <Field
          label="Show the High Alch column"
          hint="The wiki's drop tables carry both a Grand Exchange price and a high alchemy value. Off by default: the panel is a fraction of an article page's width, and of the two the price is what a drop is usually being weighed against."
          below={<DropExample showAlch={settings.showHighAlchInDrops} />}
        >
          <Switch
            checked={settings.showHighAlchInDrops}
            onChange={(showHighAlchInDrops) => patch({ showHighAlchInDrops })}
            label="Show the High Alch column"
          />
        </Field>
      </Group>
        </>
      )}

      {tab === 'Search' && (
        <>
      <Group title="Keyword matching">
        <AliasField
          aliases={settings.keywordAliases}
          onChange={(keywordAliases) => patch({ keywordAliases })}
        />
      </Group>

      <Group title="Wiki data">
        <Field
          label="Contact address"
          hint="Sent in the User-Agent on wiki requests. The OSRS Wiki asks automated clients to say who they are and how to reach them; it costs nothing and keeps you off their block list."
        >
          <input
            type="text"
            value={settings.contactEmail}
            spellCheck={false}
            placeholder="you@example.com"
            onChange={(e) => patch({ contactEmail: e.target.value })}
          />
        </Field>

        <TitleIndexField />
        <PageCacheField />
      </Group>
        </>
      )}

      {tab === 'About' && (
        <Group title="About">
          <UpdateField />
        </Group>
      )}
    </div>
  )
}

/**
 * A keybind, set by pressing it.
 *
 * The box used to be a text field, which meant knowing that the thing you press
 * is spelled `Control+Shift+Space` — and typing it wrong gave you a shortcut
 * that silently did not work, with nothing to say so. Pressing the keys removes
 * the spelling from the problem entirely.
 *
 * Capture is explicit at both ends: a button to start, and a save to commit.
 * A field that listened while merely focused would eat the keyboard of anyone
 * tabbing through the page, and one that committed the first chord it saw would
 * be unable to record a combination you passed through on the way — Ctrl+Shift+F
 * begins as Ctrl+F.
 */
function KeyBind({
  value,
  scope,
  onChange,
}: {
  value: string
  scope: BindScope
  onChange: (spec: string) => void
}): JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)
  const [held, setHeld] = useState<string[]>([])
  const [problem, setProblem] = useState<string | null>(null)
  const capturing = draft !== null

  useEffect(() => {
    if (!capturing) return

    /**
     * Capture phase, and nothing escapes.
     *
     * Every shortcut in this app listens on `window`, so a bubble-phase
     * listener here would run after them: pressing Ctrl+F to bind it would
     * first focus the search box, and Escape to cancel would navigate out of
     * Settings. Taking the event first and stopping it dead is what makes the
     * keyboard belong to this control while it is armed.
     */
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()

      if (e.key === 'Escape') {
        setDraft(null)
        setHeld([])
        setProblem(null)
        return
      }

      const parts: string[] = []
      if (e.ctrlKey) parts.push('Ctrl')
      if (e.altKey) parts.push('Alt')
      if (e.shiftKey) parts.push('Shift')
      if (e.metaKey) parts.push('Win')
      setHeld(parts)

      const got = capture(e, scope)
      // Modifiers alone: show them building up, and wait for the real key.
      if (!got) return
      if (got.problem) {
        setProblem(got.problem)
        return
      }
      setProblem(null)
      setDraft(got.spec)
    }

    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [capturing, scope])

  const start = (): void => {
    setDraft('')
    setHeld([])
    setProblem(null)
  }
  const cancel = (): void => {
    setDraft(null)
    setHeld([])
    setProblem(null)
  }
  const save = (): void => {
    if (draft) onChange(draft)
    cancel()
  }

  // While armed: the chord so far, or the modifiers still being held.
  const shown = capturing ? (draft ? specParts(draft) : held) : specParts(value)

  return (
    <div className="keybind">
      <div className={`keybind-keys ${capturing ? 'is-listening' : ''}`}>
        {shown.length > 0 ? (
          shown.map((part, i) => (
            <kbd key={`${part}-${i}`} className="keybind-key">
              {part}
            </kbd>
          ))
        ) : (
          <span className="keybind-empty">{capturing ? 'Press keys…' : 'Not set'}</span>
        )}
      </div>

      {capturing ? (
        <>
          <button type="button" className="btn" onClick={save} disabled={!draft}>
            Save
          </button>
          <button type="button" className="btn" onClick={cancel}>
            Cancel
          </button>
        </>
      ) : (
        <button type="button" className="btn" onClick={start}>
          Change
        </button>
      )}

      {problem && <p className="keybind-problem">{problem}</p>}
    </div>
  )
}

/**
 * A drop row, as it would be drawn.
 *
 * The setting hides a column, and a column you cannot see is hard to have an
 * opinion about — the name "High Alch" says what the number is but not what
 * turning it off costs you. Showing the row itself answers that in the time it
 * takes to glance at it, and it moves as the switch does, so the toggle
 * demonstrates itself rather than being described.
 */
function DropExample({ showAlch }: { showAlch: boolean }): JSX.Element {
  return (
    <table className="settings-example" aria-hidden="true">
      <thead>
        <tr>
          <th>Item</th>
          <th>Quantity</th>
          <th>Rarity</th>
          <th>Price</th>
          {showAlch && <th>High Alch</th>}
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Rune scimitar</td>
          <td>1</td>
          <td className="settings-example-rarity">1/128</td>
          <td>14,900</td>
          {showAlch && <td>15,360</td>}
        </tr>
      </tbody>
    </table>
  )
}

/**
 * Search synonyms, as an editable list.
 *
 * Written straight through to the setting on every keystroke rather than held
 * in a draft. Main lowercases on the way in but keeps incomplete rows and
 * spaces exactly as typed — trimming here once meant the space between the
 * words of a phrase vanished before the next word could land. A half-typed
 * rule is simply a rule that does not fire yet; there is no invalid state to
 * protect the user from, and a Save button for a two-word rule would be more
 * ceremony than the rule.
 */
function AliasField({
  aliases,
  onChange,
}: {
  aliases: KeywordAlias[]
  onChange: (next: KeywordAlias[]) => void
}): JSX.Element {
  const edit = (index: number, part: Partial<KeywordAlias>): void =>
    onChange(aliases.map((a, i) => (i === index ? { ...a, ...part } : a)))

  return (
    <Field
      label="Match a word or phrase with another"
      hint="Typing what is on the left also searches for what is on the right, so “scurrius bis” finds Scurrius/Strategies — the wiki names that page formally and nobody types it that way. Either side can be a phrase, like “best in slot” → “strategies”. Whole words only, so a rule for “bis” will not fire inside “Bisque”."
    >
      <div className="settings-aliases">
        {aliases.map((alias, i) => (
          <div className="settings-alias" key={i}>
            <input
              type="text"
              value={alias.from}
              spellCheck={false}
              aria-label="Word you type"
              placeholder="bis"
              onChange={(e) => edit(i, { from: e.target.value })}
            />
            <span className="settings-alias-arrow" aria-hidden="true">
              →
            </span>
            <input
              type="text"
              value={alias.to}
              spellCheck={false}
              aria-label="Word to search for"
              placeholder="strategies"
              onChange={(e) => edit(i, { to: e.target.value })}
            />
            <button
              type="button"
              className="settings-alias-remove"
              aria-label={`Remove ${alias.from || 'this rule'}`}
              onClick={() => onChange(aliases.filter((_, n) => n !== i))}
            >
              ×
            </button>
          </div>
        ))}

        <button
          type="button"
          className="btn settings-alias-add"
          onClick={() => onChange([...aliases, { from: '', to: '' }])}
        >
          Add a word
        </button>
      </div>
    </Field>
  )
}

/** A titled run of fields. The heading carries the top rule, so the first
 *  field in each group does not draw a second one under it. */
function Group({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <section className="settings-group">
      <h2>{title}</h2>
      {children}
    </section>
  )
}

/** Offered interface scales. Clamped to the same range in main's `sanitize`. */
const SCALE_MIN = 0.5
const SCALE_MAX = 2

/**
 * The interface scale, as a number you can type between two nudge buttons.
 *
 * A slider was the first instinct and the wrong one: changing this rescales the
 * settings page the control sits on, so the handle moved out from under the
 * cursor mid-drag and the thing fought every attempt to use it. Buttons and a
 * box are both committed in one action — whatever relocation follows is a
 * redraw you are no longer holding onto.
 *
 * Typing is kept in a draft string rather than written straight through. The
 * committed value is a multiplier and the field shows a percentage, so writing
 * on every keystroke would reformat the text under the caret — and an
 * in-between state like an empty box has no valid multiplier to be.
 */
function ScaleStepper({
  value,
  onChange,
}: {
  value: number
  onChange: (scale: number) => void
}): JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)
  const percent = Math.round(value * 100)

  const commit = (): void => {
    // Digits only: the box shows its own unit, so what comes back is usually
    // "125%" — and there is no reading of a stray character that beats
    // ignoring it.
    const typed = Number.parseInt((draft ?? '').replace(/[^0-9]/g, ''), 10)
    // Clamping is main's job, on the way in. Anything unreadable simply
    // reverts, which is what dropping the draft does.
    if (Number.isFinite(typed)) onChange(typed / 100)
    setDraft(null)
  }

  /**
   * The buttons ask main to step, rather than sending a value they worked out
   * themselves. `value` is a mirror of main's setting and only updates when the
   * broadcast comes back, so two quick presses both computed from the same
   * number and the second one undid the first — one press lost out of every
   * pair. Main holds the scale and adds to it, so every press counts.
   */
  const nudge = (direction: ScaleDirection): void => {
    setDraft(null)
    window.rp.bumpScale(direction)
  }

  return (
    <div className="settings-stepper">
      <button
        type="button"
        className="settings-nudge"
        aria-label="Smaller"
        disabled={value <= SCALE_MIN}
        onClick={() => nudge('out')}
      >
        −
      </button>
      <input
        type="text"
        inputMode="numeric"
        aria-label="Interface size"
        value={draft ?? `${percent}%`}
        onChange={(e) => setDraft(e.target.value)}
        // Selected on focus because the box is showing "100%", not "100" —
        // without this you would be typing into the middle of a unit.
        onFocus={(e) => e.target.select()}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') setDraft(null)
        }}
      />
      <button
        type="button"
        className="settings-nudge"
        aria-label="Larger"
        disabled={value >= SCALE_MAX}
        onClick={() => nudge('in')}
      >
        +
      </button>
    </div>
  )
}


const MODE_LABEL: Record<AccountMode, string> = {
  main: 'main',
  ironman: 'ironman',
  hardcore: 'hardcore ironman',
  ultimate: 'ultimate ironman',
}

/**
 * Your RuneScape name, and proof it resolved to something.
 *
 * A name typed into a box and never confirmed is the worst version of this: the
 * feature it turns on is subtle enough that a typo reads as "it does not work"
 * rather than "that is not my name". So the field looks the name up, reports the
 * account it found, and stores the hiscores' own spelling rather than yours.
 *
 * Nothing here needs an account or a login. The hiscores are public, and the
 * levels are only used to colour requirements you are reading anyway.
 */
function RsnField(): JSX.Element {
  const settings = useStore((s) => s.settings)
  const patch = useStore((s) => s.patchSettings)
  const levels = usePlayer((s) => s.levels)
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  const rsn = settings?.rsn ?? ''

  const verify = (): void => {
    const name = rsn.trim()
    if (!name || checking) return
    setChecking(true)
    setResult(null)
    setFailed(false)
    window.rp
      .hiscores(name)
      .then((data) => {
        // The hiscores' spelling, not yours — capitalisation and the space that
        // is really an underscore both come back canonical.
        patch({ rsn: data.name })
        setResult(`${data.name} — ${MODE_LABEL[data.mode]}, total level ${data.totalLevel.toLocaleString()}.`)
      })
      .catch((err: unknown) => {
        setFailed(true)
        setResult(err instanceof Error ? err.message : String(err))
      })
      .finally(() => setChecking(false))
  }

  const hint = result
    ? failed
      ? `Could not look that up: ${result}`
      : result
    : rsn.trim() && levels
      ? 'Skill requirements on articles are marked against these levels.'
      : 'Marks skill requirements on wiki pages as met or not. Read from the public hiscores — no account, no login, and nothing is sent anywhere until you put a name here.'

  return (
    <Field label="RuneScape name" hint={hint}>
      <div className="field-row">
        <input
          type="text"
          value={rsn}
          spellCheck={false}
          maxLength={12}
          placeholder="Your display name"
          onChange={(e) => {
            patch({ rsn: e.target.value })
            setResult(null)
            setFailed(false)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') verify()
          }}
        />
        <button type="button" className="btn" disabled={!rsn.trim() || checking} onClick={verify}>
          {checking ? 'Checking…' : 'Check'}
        </button>
      </div>
    </Field>
  )
}

/**
 * Updates — the version you are on, and a manual check.
 *
 * Rune Panel checks on its own twenty seconds after launch and once a day
 * after, but "is there a new one" is a question people ask on their own
 * schedule, usually right after seeing a release mentioned somewhere.
 *
 * Every state answers in the same place, including the boring ones. A check
 * that silently does nothing when you are already current is indistinguishable
 * from a broken button.
 */
function UpdateField(): JSX.Element {
  const [status, setStatus] = useState<UpdateStatus | null>(null)

  useEffect(() => {
    void window.rp.getUpdate().then(setStatus)
    return window.rp.onUpdateStatus(setStatus)
  }, [])

  const version = status ? `Rune Panel ${status.currentVersion}` : 'Rune Panel'
  const hint = !status
    ? 'Checking…'
    : {
        idle: `${version}. Checked automatically after launch and once a day.`,
        checking: 'Asking GitHub…',
        available: `Version ${status.version} is available — the banner at the top of the window will download it.`,
        downloading: `Downloading ${status.version} — ${status.progress}%.`,
        ready: `Version ${status.version} is downloaded and installs on restart.`,
        current: `${version}, which is the latest release.`,
        error: `Could not check: ${status.message ?? 'unknown error'}. Usually just no network.`,
        // The development build. Saying so is kinder than a button that
        // reports "up to date" from a source it never contacted.
        unsupported: `${version}, running from source. Updates only apply to an installed build.`,
      }[status.state]

  const busy = status?.state === 'checking' || status?.state === 'downloading'

  return (
    <Field label="Updates" hint={hint}>
      <button
        type="button"
        className="btn"
        disabled={busy || status?.state === 'unsupported'}
        onClick={() => window.rp.checkUpdate()}
      >
        {status?.state === 'checking' ? 'Checking…' : 'Check now'}
      </button>
    </Field>
  )
}

/**
 * The wiki title index — status and a manual rebuild.
 *
 * Rebuilding is roughly 880 requests over four minutes, so the button says so
 * rather than presenting itself as a refresh. It runs automatically on first
 * launch and weekly; this is for when you want it sooner.
 */
function TitleIndexField(): JSX.Element {
  const [index, setIndex] = useState<TitleIndexState | null>(null)

  useEffect(() => {
    void window.rp.getTitleIndex().then(setIndex)
    // Progress events arrive per batch, which is also the cheapest cue to
    // re-read the counts.
    return window.rp.onSyncProgress(() => {
      void window.rp.getTitleIndex().then(setIndex)
    })
  }, [])

  const hint = !index
    ? 'Checking…'
    : index.syncing
      ? `Building — ${index.progress.phase}, ${index.progress.fetched.toLocaleString()} titles over ${index.progress.requests} requests.`
      : index.count === 0
        ? 'Not built yet. Roughly 880 requests over about four minutes.'
        : `${(index.count - index.redirects).toLocaleString()} articles and ${index.redirects.toLocaleString()} aliases. Last built ${index.syncedAt ? new Date(index.syncedAt).toLocaleString() : 'never'}.`

  return (
    <Field label="Wiki title index" hint={hint}>
      <button
        type="button"
        className="btn"
        disabled={index?.syncing ?? true}
        onClick={() => window.rp.syncTitles()}
      >
        {index?.syncing ? 'Building…' : 'Rebuild'}
      </button>
    </Field>
  )
}

/**
 * The article cache and the background crawler.
 *
 * Worth surfacing rather than hiding: it makes network requests on your behalf
 * while you are not looking, and anything that does that should be visible and
 * stoppable.
 */
function PageCacheField(): JSX.Element {
  const [crawl, setCrawl] = useState<CrawlState | null>(null)

  useEffect(() => {
    void window.rp.getCrawlState().then(setCrawl)
    return window.rp.onCrawlProgress(setCrawl)
  }, [])

  const busy = crawl?.phase === 'crawling' || crawl?.phase === 'refreshing' || crawl?.phase === 'paused'

  const hint = !crawl
    ? 'Checking…'
    : crawl.phase === 'paused'
      ? `Paused while the window is open — ${crawl.cached.toLocaleString()} pages cached, ${crawl.remaining} queued.`
      : crawl.phase === 'refreshing'
        ? 'Asking the wiki what changed…'
        : crawl.phase === 'crawling'
          ? `Filling — ${crawl.done} fetched, ${crawl.remaining} queued, ${crawl.cached.toLocaleString()} cached.`
          : `${crawl.cached.toLocaleString()} pages cached${crawl.stale > 0 ? `, ${crawl.stale} out of date` : ''}. Pages are cached as you read them and refreshed in the background while the window is closed.`

  return (
    <Field label="Article cache" hint={hint}>
      <button
        type="button"
        className="btn"
        onClick={() => (busy ? window.rp.stopCrawl() : window.rp.startCrawl())}
      >
        {busy ? 'Stop' : 'Refresh now'}
      </button>
    </Field>
  )
}

function Field({
  label,
  hint,
  below,
  children,
}: {
  label: string
  hint: string
  /**
   * Anything that belongs under the description rather than beside it.
   *
   * For a control that shows its own effect: an example that changes size as
   * the switch moves shoves the switch around when it sits in the control
   * column, and a control that walks away from the cursor as you use it is a
   * control you have to chase. Under the text it can grow in the one direction
   * nothing else depends on.
   */
  below?: React.ReactNode
  children: React.ReactNode
}): JSX.Element {
  return (
    <div className="field">
      <div className="field-label">
        <strong>{label}</strong>
        <span>{hint}</span>
        {below}
      </div>
      <div className="field-control">{children}</div>
    </div>
  )
}

function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      className="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
    />
  )
}
