/**
 * Settings.
 *
 * A view rather than a modal sheet — the window is already a transient overlay,
 * and stacking a second layer of dismissal on top of it earns nothing.
 */

import { useEffect, useState, type JSX } from 'react'
import type { CrawlState, TitleIndexState } from '@shared/ipc'
import { useStore } from './store'

export function SettingsView(): JSX.Element {
  const settings = useStore((s) => s.settings)
  const patch = useStore((s) => s.patchSettings)

  if (!settings) return <div className="placeholder">Loading…</div>

  return (
    <div className="settings">
      <h1>Settings</h1>

      <Field
        label="Hotkey"
        hint="Global shortcut that opens and closes Rune Buddy. Electron accelerator syntax, e.g. Control+Shift+Space."
      >
        <input
          type="text"
          value={settings.hotkey}
          spellCheck={false}
          onChange={(e) => patch({ hotkey: e.target.value })}
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
    </div>
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
    void window.rb.getTitleIndex().then(setIndex)
    // Progress events arrive per batch, which is also the cheapest cue to
    // re-read the counts.
    return window.rb.onSyncProgress(() => {
      void window.rb.getTitleIndex().then(setIndex)
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
        onClick={() => window.rb.syncTitles()}
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
    void window.rb.getCrawlState().then(setCrawl)
    return window.rb.onCrawlProgress(setCrawl)
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
        onClick={() => (busy ? window.rb.stopCrawl() : window.rb.startCrawl())}
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
