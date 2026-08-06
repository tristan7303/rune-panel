/**
 * The shell.
 *
 * Rail on the left, top bar with the drag region and window controls, routed
 * content in the middle. Everything renders against the navigation stack in
 * nav.ts; the rail is a set of shortcuts into it, not a separate notion of
 * where you are.
 */

import { useEffect, useRef, useState, type JSX } from 'react'
import { useStore } from './store'
import type { Theme } from '@shared/ipc'
import { useNav, useRoute, useCanGoBack, useCanGoForward, routeTitle, type Route } from './nav'
import { SettingsView } from './Settings'
import { Home } from './Home'
import { HeaderSearch } from './HeaderSearch'
import { Article } from './Article'
import { ToolPane } from './ToolPane'
import { Profile } from './Profile'
import { Calculators } from './Calculators'
import { Grand } from './Grand'
import mark from './assets/mark.png'
import profileLogo from './assets/logo.png'
import {
  SwordIcon,
  CoinsIcon,
  ChartIcon,
  CalculatorIcon,
  GearIcon,
  SunIcon,
  MoonIcon,
  PageIcon,
  BackIcon,
  ForwardIcon,
  CloseIcon,
} from './icons'

// No Search entry: the wiki search box lives in the header, reachable from
// every view without spending a route on it.
const NAV: Array<{ route: Route; label: string; icon: () => JSX.Element }> = [
  { route: { kind: 'tool', id: 'dps' }, label: 'DPS calculator', icon: SwordIcon },
  { route: { kind: 'ge' }, label: 'Grand Exchange', icon: CoinsIcon },
  { route: { kind: 'hiscores' }, label: 'Hiscores', icon: ChartIcon },
  {
    route: { kind: 'tool', id: 'profile' },
    label: 'RuneProfile',
    // Their own mark rather than a generic person: this entry leads somewhere
    // that is recognisably a different product, and it should look like it.
    icon: () => <img className="rail-img" src={profileLogo} alt="" draggable={false} />,
  },
  { route: { kind: 'tool', id: 'calculators' }, label: 'Calculators', icon: CalculatorIcon },
]

export function App(): JSX.Element {
  const route = useRoute()
  const { push, back, forward } = useNav()
  const canBack = useCanGoBack()
  const canForward = useCanGoForward()
  const setSettings = useStore((s) => s.setSettings)

  // Pull settings once, then track main's broadcasts. Main owns the sanitized
  // truth; the renderer only ever mirrors it.
  useEffect(() => {
    void window.rp.getSettings().then(setSettings)
    return window.rp.onSettings(setSettings)
  }, [setSettings])

  // The theme lives on <html> rather than in React state so the whole
  // stylesheet — including the article CSS, which styles markup React never
  // touches — can respond to one attribute.
  const theme = useStore((s) => s.settings?.theme ?? 'dark')
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  // Reopening keeps whatever was on screen. Resetting made sense when search
  // was a destination you had to navigate to; now that Ctrl+F reaches it from
  // anywhere, throwing away the article you were mid-way through is pure loss.

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Alt+arrows and the mouse thumb buttons, the two conventions people
      // already have for history.
      if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault()
        back()
        return
      }
      if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault()
        forward()
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        // Unwind one layer: out of a subview first, then out of the app.
        if (useNav.getState().index > 0) back()
        else window.rp.hide()
      }
    }

    const onMouse = (e: MouseEvent): void => {
      if (e.button === 3) {
        e.preventDefault()
        back()
      } else if (e.button === 4) {
        e.preventDefault()
        forward()
      }
    }

    window.addEventListener('keydown', onKey)
    window.addEventListener('mouseup', onMouse)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mouseup', onMouse)
    }
  }, [push, back, forward])

  return (
    <div className="shell">
      <nav className="rail">
        {/* Clicking the mark goes home, the way a site logo does. */}
        <button
          className="rail-mark"
          title="Rune Panel — home"
          aria-label="Rune Panel — home"
          onClick={() => push({ kind: 'home' })}
        >
          <img src={mark} alt="" draggable={false} />
        </button>
        {NAV.map(({ route: target, label, icon: Icon }) => (
          <button
            key={label}
            className={`rail-btn ${isActive(route, target) ? 'is-active' : ''}`}
            title={label}
            aria-label={label}
            aria-current={isActive(route, target)}
            onClick={() => push(target)}
          >
            <Icon />
          </button>
        ))}
        <div className="rail-spacer" />
        <ThemeToggle />
        <button
          className={`rail-btn ${route.kind === 'settings' ? 'is-active' : ''}`}
          title="Settings"
          aria-label="Settings"
          onClick={() => push({ kind: 'settings' })}
        >
          <GearIcon />
        </button>
      </nav>

      <div className="main">
        <header className="topbar">
          <button className="icon-btn" disabled={!canBack} title="Back (Alt+←)" onClick={back}>
            <BackIcon />
          </button>
          <button
            className="icon-btn"
            disabled={!canForward}
            title="Forward (Alt+→)"
            onClick={forward}
          >
            <ForwardIcon />
          </button>
          <span className="topbar-title">{routeTitle(route)}</span>
          {/* Absolutely centred rather than placed in the flex run: the route
              title varies from "Home" to a full article name, and a flexed
              search box would slide left and right as you navigate. */}
          <HeaderSearch />
          <button
            className="icon-btn is-close"
            title="Close (Esc)"
            aria-label="Close"
            onClick={() => window.rp.hide()}
          >
            <CloseIcon />
          </button>
        </header>

        {/* Articles own their scrolling so the infobox can float against the
            full width, and tools are a native view that must not be scrolled
            by us at all; everything else scrolls inside .content. */}
        <main
          className="content"
          data-scroll={route.kind === 'page' || route.kind === 'tool' ? 'inner' : 'outer'}
        >
          <Body route={route} />
        </main>
      </div>
    </div>
  )
}

function Body({ route }: { route: Route }): JSX.Element {
  switch (route.kind) {
    case 'home':
      return <Home />
    case 'settings':
      return <SettingsView />
    case 'page':
      // Keyed so switching articles remounts rather than reusing state that
      // belongs to the previous page.
      return <Article title={route.title} key={route.title} />
    case 'ge':
      return <Grand itemId={route.itemId} key={route.itemId ?? 'search'} />
    case 'tool':
      return <Tool id={route.id} />
    default:
      return <Placeholder title={routeTitle(route)} note="Not built yet." />
  }
}

const THEMES: Array<{ id: Theme; label: string; hint: string; icon: () => JSX.Element }> = [
  { id: 'dark', label: 'Dark', hint: 'Over a dark game client', icon: MoonIcon },
  { id: 'parchment', label: 'Parchment', hint: 'Warm tan, easiest for long reads', icon: PageIcon },
  { id: 'light', label: 'Light', hint: 'Plain white', icon: SunIcon },
]

/**
 * Theme picker, directly above settings.
 *
 * A small popup rather than a cycling button: with three options a toggle makes
 * you click through the one you do not want, and gives no hint what the next
 * press will do. This shows all three at once with the current one marked.
 */
function ThemeToggle(): JSX.Element {
  const theme = useStore((s) => s.settings?.theme ?? 'dark')
  const patch = useStore((s) => s.patchSettings)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Dismiss on an outside click or Escape, the two things every popup owes you.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      // Beat the window handler, which would otherwise close the whole app.
      e.stopPropagation()
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  const Current = THEMES.find((t) => t.id === theme)?.icon ?? MoonIcon

  return (
    <div className="theme-picker" ref={ref}>
      <button
        className={`rail-btn ${open ? 'is-active' : ''}`}
        title="Appearance"
        aria-label="Appearance"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Current />
      </button>

      {open && (
        <div className="theme-menu" role="menu">
          {THEMES.map(({ id, label, hint, icon: Icon }) => (
            <button
              key={id}
              role="menuitemradio"
              aria-checked={id === theme}
              className={`theme-option ${id === theme ? 'is-active' : ''}`}
              onClick={() => {
                patch({ theme: id })
                setOpen(false)
              }}
            >
              <span className="theme-swatch" data-theme-swatch={id} />
              <span className="theme-option-text">
                <strong>{label}</strong>
                <em>{hint}</em>
              </span>
              <Icon />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Tool({ id }: { id: 'dps' | 'calculators' | 'profile' }): JSX.Element {
  switch (id) {
    case 'dps':
      // No picker: the DPS calculator is one page, so go straight into it.
      return <ToolPane id="dps" />
    case 'profile':
      return <Profile />
    case 'calculators':
      return <Calculators />
  }
}

function Placeholder({ title, note }: { title: string; note: string }): JSX.Element {
  return (
    <div className="placeholder">
      <h2>{title}</h2>
      <p>{note}</p>
    </div>
  )
}

/** The rail highlights the family a route belongs to, not an exact match. */
function isActive(current: Route, target: Route): boolean {
  if (current.kind !== target.kind) return false
  if (current.kind === 'tool' && target.kind === 'tool') return current.id === target.id
  return true
}
