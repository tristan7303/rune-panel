/**
 * Settings.
 *
 * A view rather than a modal sheet — the window is already a transient overlay,
 * and stacking a second layer of dismissal on top of it earns nothing.
 */

import type { JSX } from 'react'
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
    </div>
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
