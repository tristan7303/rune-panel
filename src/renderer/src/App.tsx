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
import { GeTracker } from './GeTracker'
import { Calculators } from './Calculators'
import { Grand } from './Grand'
import { Hiscores } from './Hiscores'
import { Setup } from './Setup'
import { UpdateBanner } from './UpdateBanner'
import { focusPrimary } from './focus'
import { usePlayer, seedRsn } from './player'
import { onBind } from './keys'
import mark from './assets/mark.png'
import profileLogo from './assets/logo.png'
import {
  DpsIcon,
  CoinsIcon,
  TrophyIcon,
  TrendIcon,
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
  { route: { kind: 'tool', id: 'dps' }, label: 'DPS calculator', icon: DpsIcon },
  { route: { kind: 'ge' }, label: 'Grand Exchange', icon: CoinsIcon },
  // Beside the Grand Exchange rather than beside the other embedded tools: what
  // groups these two is the question you are asking, not how they are built.
  { route: { kind: 'tool', id: 'getracker' }, label: 'GE Tracker', icon: TrendIcon },
  { route: { kind: 'hiscores' }, label: 'Hiscores', icon: TrophyIcon },
  { route: { kind: 'tool', id: 'calculators' }, label: 'Calculators', icon: CalculatorIcon },
  {
    route: { kind: 'tool', id: 'profile' },
    label: 'RuneProfile',
    // Their own mark rather than a generic person: this entry leads somewhere
    // that is recognisably a different product, and it should look like it.
    // Last in the list because it is the only artwork among line icons, and
    // breaking that run in the middle read as a mistake.
    icon: () => <img className="rail-img" src={profileLogo} alt="" draggable={false} />,
  },
]

export function App(): JSX.Element {
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null)
  const route = useRoute()
  const { push, back, forward } = useNav()
  const canBack = useCanGoBack()
  const canForward = useCanGoForward()
  const setSettings = useStore((s) => s.setSettings)

  // Whether this is a first run. Null until asked, so the shell does not flash
  // before the wizard appears.
  useEffect(() => {
    void window.rp.getSetup().then((p) => setNeedsSetup(!p.done))
  }, [])

  // Pull settings once, then track main's broadcasts. Main owns the sanitized
  // truth; the renderer only ever mirrors it.
  useEffect(() => {
    void window.rp.getSettings().then(setSettings)
    return window.rp.onSettings(setSettings)
  }, [setSettings])

  // Your levels, for marking requirements on articles. Driven off the setting
  // rather than fetched on demand per page: one lookup answers every article
  // you open, and main memoises it on top of that.
  const rsn = useStore((s) => s.settings?.rsn)
  const patchSettings = useStore((s) => s.patchSettings)
  useEffect(() => {
    if (rsn === undefined) return
    const carried = seedRsn(rsn)
    if (carried) {
      patchSettings({ rsn: carried })
      return
    }
    if (rsn.trim()) usePlayer.getState().load(rsn)
    else usePlayer.getState().clear()
  }, [rsn, patchSettings])

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
  //
  // What it does do is put the caret in a search box, on every route. Summoning
  // the panel is nearly always the first half of "look something up", and the
  // second half should not need a click. The cost is real and accepted: reopen
  // on an article and Space scrolls nothing until you click into the page.
  useEffect(() => window.rp.onShown(() => focusPrimary()), [])

  // Arriving somewhere with a search box focuses it, for the same reason. Keyed
  // on the kind rather than the whole route, so choosing a GE item does not
  // yank the caret back out of the results you are reading.
  const focusTarget = focusOnEnter(route)
  useEffect(() => {
    if (focusTarget) focusPrimary({ pageOnly: focusTarget === 'page-input' })
  }, [focusTarget])

  // Straight to the Grand Exchange, ready to type. Pressing it again once you
  // are there focuses the box rather than doing nothing, so the same key gets
  // you from anywhere to looking up a second item.
  //
  // Navigating there already focuses the box, via the effect above — but only
  // when the route actually changes, which is precisely the case this has to
  // handle itself. The route is read from the store rather than from `route`,
  // so the listener is not torn down and rebuilt on every navigation.
  const geKey = useStore((s) => s.settings?.geKey ?? 'Ctrl+G')
  useEffect(
    () =>
      onBind(geKey, () => {
        const { entries, index } = useNav.getState()
        if (entries[index].kind === 'ge') focusPrimary()
        else push({ kind: 'ge' })
      }),
    [geKey, push]
  )

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

  if (needsSetup === null) return <div className="shell" />
  if (needsSetup) {
    return (
      <div className="shell is-setup">
        <Setup onDone={() => setNeedsSetup(false)} />
      </div>
    )
  }

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

        <UpdateBanner />

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
      // Keyed on title alone: a hash-only change must not remount, or jumping
      // to a section would re-fetch the page and throw away the scroll it is
      // about to perform.
      return <Article title={route.title} hash={route.hash} key={route.title} />
    case 'ge':
      return <Grand itemId={route.itemId} key={route.itemId ?? 'search'} />
    case 'hiscores':
      return <Hiscores />
    case 'tool':
      return <Tool id={route.id} arg={route.arg} />
    default:
      return <Placeholder title={routeTitle(route)} note="Not built yet." />
  }
}

// Ordered dark to light, so the list reads as a ramp rather than a set.
const THEMES: Array<{ id: Theme; label: string; hint: string; icon: () => JSX.Element }> = [
  { id: 'dark', label: 'Dark', hint: 'Over a dark game client', icon: MoonIcon },
  { id: 'mocha', label: 'Mocha', hint: 'Warm and dim, for reading at night', icon: MoonIcon },
  { id: 'parchment', label: 'Parchment', hint: 'Warm tan, easiest for long reads', icon: PageIcon },
  { id: 'light', label: 'Light', hint: 'Plain white', icon: SunIcon },
]

/**
 * Theme picker, directly above settings.
 *
 * A small popup rather than a cycling button: a toggle makes you click through
 * the ones you do not want and gives no hint what the next press will do. This
 * shows every theme at once with the current one marked.
 */
function ThemeToggle(): JSX.Element {
  const theme = useStore((s) => s.settings?.theme ?? 'dark')
  const patch = useStore((s) => s.patchSettings)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const pushOverlay = useStore((s) => s.pushOverlay)
  const popOverlay = useStore((s) => s.popOverlay)
  const setOverlayRect = useStore((s) => s.setOverlayRect)

  // Registered while open, with its rectangle, so an embedded tool can shrink
  // clear of it rather than disappear. See ToolPane's `avoiding`.
  useEffect(() => {
    if (!open) return
    pushOverlay()
    // Measured after paint, when the menu actually has a size.
    const frame = requestAnimationFrame(() => {
      const r = menuRef.current?.getBoundingClientRect()
      if (r) setOverlayRect({ x: r.x, y: r.y, width: r.width, height: r.height })
    })
    return () => {
      cancelAnimationFrame(frame)
      popOverlay()
    }
  }, [open, pushOverlay, popOverlay, setOverlayRect])

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
        <div className="theme-menu" role="menu" ref={menuRef}>
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

function Tool({
  id,
  arg,
}: {
  id: 'dps' | 'calculators' | 'profile' | 'getracker'
  arg?: string
}): JSX.Element {
  switch (id) {
    case 'dps':
      // No picker: the DPS calculator is one page, so go straight into it.
      return <ToolPane id="dps" />
    case 'profile':
      return <Profile />
    case 'calculators':
      return <Calculators />
    case 'getracker':
      // Keyed on the argument so arriving from a different item remounts and
      // opens on it, rather than keeping whatever the view was last showing.
      return <GeTracker item={arg} key={arg ?? ''} />
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

/**
 * Whether arriving at a route should put the caret in a box, and which box.
 *
 * Returns a string rather than a boolean so the value can key an effect: it
 * changes when you move between these routes and stays put when only a route's
 * argument changes, which is what keeps choosing a GE item from stealing focus
 * back to the search field.
 *
 * `page-input` means the route's own input or nothing — never the header wiki
 * search. Used for the RuneProfile route, where "no input of its own" means the
 * embedded pane is up and holding focus for a reason.
 *
 * Articles are absent deliberately. Following a link is reading, not searching,
 * and the header box is one Ctrl+F away.
 */
function focusOnEnter(route: Route): string | null {
  switch (route.kind) {
    case 'home':
    case 'hiscores':
    case 'ge':
      return route.kind
    case 'tool':
      // Both of these front a pane with a box of our own. The DPS calculator
      // and the wiki calculators have no such box, and stealing focus from a
      // pane that owns its own inputs is worse than not focusing anything.
      return route.id === 'profile' || route.id === 'getracker' ? 'page-input' : null
    default:
      return null
  }
}

/** The rail highlights the family a route belongs to, not an exact match. */
function isActive(current: Route, target: Route): boolean {
  if (current.kind !== target.kind) return false
  if (current.kind === 'tool' && target.kind === 'tool') return current.id === target.id
  return true
}
