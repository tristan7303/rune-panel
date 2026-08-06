/**
 * The shell.
 *
 * Rail on the left, top bar with the drag region and window controls, content
 * in the middle. Phase 2 replaces the placeholder body with real routes; the
 * frame around it is what phase 0 has to get right, because everything else
 * hangs off it.
 */

import { useEffect, type JSX } from 'react'
import { useStore, type View } from './store'
import { SettingsView } from './Settings'
import {
  SearchIcon,
  BookIcon,
  SwordIcon,
  CoinsIcon,
  ChartIcon,
  UserIcon,
  CalculatorIcon,
  GearIcon,
  BackIcon,
  ForwardIcon,
  CloseIcon,
} from './icons'

const NAV: Array<{ view: View; label: string; icon: () => JSX.Element }> = [
  { view: 'search', label: 'Search', icon: SearchIcon },
  { view: 'wiki', label: 'Wiki', icon: BookIcon },
  { view: 'dps', label: 'DPS calculator', icon: SwordIcon },
  { view: 'ge', label: 'Grand Exchange', icon: CoinsIcon },
  { view: 'hiscores', label: 'Hiscores', icon: ChartIcon },
  { view: 'profile', label: 'RuneProfile', icon: UserIcon },
  { view: 'calculators', label: 'Calculators', icon: CalculatorIcon },
]

const TITLES: Record<View, string> = {
  search: 'Search',
  wiki: 'Wiki',
  dps: 'DPS calculator',
  ge: 'Grand Exchange',
  hiscores: 'Hiscores',
  profile: 'RuneProfile',
  calculators: 'Calculators',
  settings: 'Settings',
}

export function App(): JSX.Element {
  const view = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)
  const setSettings = useStore((s) => s.setSettings)

  // Pull settings once, then track main's broadcasts. Main owns the sanitized
  // truth; the renderer only ever mirrors it.
  useEffect(() => {
    void window.rb.getSettings().then(setSettings)
    return window.rb.onSettings(setSettings)
  }, [setSettings])

  // Opening always lands on search. The window is summoned to look something
  // up, and resuming whatever was on screen three hours ago is rarely it.
  useEffect(() => window.rb.onShown(() => setView('search')), [setView])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        // Escape unwinds one layer: out of settings first, then out of the app.
        if (useStore.getState().view === 'settings') setView('search')
        else window.rb.hide()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setView])

  return (
    <div className="shell">
      <nav className="rail">
        <div className="rail-mark" />
        {NAV.map(({ view: v, label, icon: Icon }) => (
          <button
            key={v}
            className={`rail-btn ${view === v ? 'is-active' : ''}`}
            title={label}
            aria-label={label}
            aria-current={view === v}
            onClick={() => setView(v)}
          >
            <Icon />
          </button>
        ))}
        <div className="rail-spacer" />
        <button
          className={`rail-btn ${view === 'settings' ? 'is-active' : ''}`}
          title="Settings"
          aria-label="Settings"
          onClick={() => setView('settings')}
        >
          <GearIcon />
        </button>
      </nav>

      <div className="main">
        <header className="topbar">
          {/* Wired to the history stack in phase 2; disabled until it exists so
              the bar does not advertise navigation it cannot perform. */}
          <button className="icon-btn" disabled title="Back">
            <BackIcon />
          </button>
          <button className="icon-btn" disabled title="Forward">
            <ForwardIcon />
          </button>
          <span className="topbar-title">{TITLES[view]}</span>
          <button
            className="icon-btn is-close"
            title="Close (Esc)"
            aria-label="Close"
            onClick={() => window.rb.hide()}
          >
            <CloseIcon />
          </button>
        </header>

        <main className="content">
          {view === 'settings' ? <SettingsView /> : <Placeholder view={view} />}
        </main>
      </div>
    </div>
  )
}

function Placeholder({ view }: { view: View }): JSX.Element {
  return (
    <div className="placeholder">
      <h2>{TITLES[view]}</h2>
      <p>
        Not built yet — press <kbd>Esc</kbd> to close.
      </p>
    </div>
  )
}
