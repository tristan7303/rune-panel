/**
 * The shell.
 *
 * Rail on the left, top bar with the drag region and window controls, routed
 * content in the middle. Everything renders against the navigation stack in
 * nav.ts; the rail is a set of shortcuts into it, not a separate notion of
 * where you are.
 */

import { useEffect, type JSX } from 'react'
import { useStore } from './store'
import { useNav, useRoute, useCanGoBack, useCanGoForward, routeTitle, type Route } from './nav'
import { SettingsView } from './Settings'
import { Search } from './Search'
import { Article } from './Article'
import { ToolPane } from './ToolPane'
import { Profile } from './Profile'
import { Calculators } from './Calculators'
import mark from './assets/mark.png'
import profileLogo from './assets/logo.png'
import {
  SearchIcon,
  SwordIcon,
  CoinsIcon,
  ChartIcon,
  CalculatorIcon,
  GearIcon,
  SunIcon,
  MoonIcon,
  BackIcon,
  ForwardIcon,
  CloseIcon,
} from './icons'

const NAV: Array<{ route: Route; label: string; icon: () => JSX.Element }> = [
  { route: { kind: 'search' }, label: 'Search', icon: SearchIcon },
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
  const { push, back, forward, reset } = useNav()
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

  // Opening always lands on a fresh search. The window is summoned to look
  // something up, and resuming a three-hour-old article rarely is it.
  useEffect(() => window.rp.onShown(() => reset()), [reset])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey

      if (mod && e.key === 'k') {
        e.preventDefault()
        push({ kind: 'search' })
        return
      }
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
          title="Rune Panel — search"
          aria-label="Rune Panel — search"
          onClick={() => push({ kind: 'search' })}
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
    case 'search':
      return <Search />
    case 'settings':
      return <SettingsView />
    case 'page':
      // Keyed so switching articles remounts rather than reusing state that
      // belongs to the previous page.
      return <Article title={route.title} key={route.title} />
    case 'tool':
      return <Tool id={route.id} />
    default:
      return <Placeholder title={routeTitle(route)} note="Not built yet." />
  }
}

/**
 * Light/dark switch, sitting directly above settings.
 *
 * A rail button rather than a settings row because it is the one preference
 * worth flipping mid-task — usually because the room's light changed, not
 * because you went looking for a setting.
 */
function ThemeToggle(): JSX.Element {
  const theme = useStore((s) => s.settings?.theme ?? 'dark')
  const patch = useStore((s) => s.patchSettings)
  const next = theme === 'dark' ? 'light' : 'dark'

  return (
    <button
      className="rail-btn"
      title={`Switch to ${next} mode`}
      aria-label={`Switch to ${next} mode`}
      onClick={() => patch({ theme: next })}
    >
      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
    </button>
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
