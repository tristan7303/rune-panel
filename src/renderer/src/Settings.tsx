/**
 * Settings.
 *
 * A view rather than a modal sheet — the window is already a transient overlay,
 * and stacking a second layer of dismissal on top of it earns nothing.
 */

import { useEffect, useState, type JSX } from 'react'
import type { CrawlState, TitleIndexState, UpdateStatus } from '@shared/ipc'
import { useStore } from './store'

export function SettingsView(): JSX.Element {
  const settings = useStore((s) => s.settings)
  const patch = useStore((s) => s.patchSettings)

  if (!settings) return <div className="placeholder">Loading…</div>

  return (
    <div className="settings">
      <h1>Settings</h1>

      {/* Keybinds first, and together. The global one is genuinely different
          from the other two — it is registered with Windows and can be lost to
          another program — so it says so rather than sitting unmarked beside
          shortcuts that always work. */}
      <Group title="Keyboard">
        <Field
          label="Open and close"
          hint="Works anywhere in Windows, including over a game. Electron accelerator syntax, e.g. Control+Shift+Space. Registered with the OS, so another program holding the same combination wins it."
        >
          <input
            type="text"
            value={settings.hotkey}
            spellCheck={false}
            onChange={(e) => patch({ hotkey: e.target.value })}
          />
        </Field>

        <Field
          label="Search the wiki"
          hint="Focuses the search box in the title bar. Ctrl+K always works too."
        >
          <input
            type="text"
            value={settings.searchKey}
            spellCheck={false}
            placeholder="Ctrl+F"
            onChange={(e) => patch({ searchKey: e.target.value })}
          />
        </Field>

        <Field
          label="Grand Exchange"
          hint="Opens the Grand Exchange with the item box focused, or just focuses it if you are already there."
        >
          <input
            type="text"
            value={settings.geKey}
            spellCheck={false}
            placeholder="Ctrl+G"
            onChange={(e) => patch({ geKey: e.target.value })}
          />
        </Field>
      </Group>

      <Group title="Window">
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
          label="Reduce motion"
          hint="Replaces the open and close animation with a quick fade. Forced on anyway if Windows is set to minimise animations."
        >
          <Switch
            checked={settings.reduceMotion}
            onChange={(reduceMotion) => patch({ reduceMotion })}
            label="Reduce motion"
          />
        </Field>
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

      <Group title="About">
        <UpdateField />
      </Group>
    </div>
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
  children,
}: {
  label: string
  hint: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <div className="field">
      <div className="field-label">
        <strong>{label}</strong>
        <span>{hint}</span>
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
