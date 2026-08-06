/**
 * Inline stroke icons.
 *
 * Drawn here rather than pulled from a set: eight glyphs do not justify a
 * dependency, and inlining keeps the renderer's CSP free of any external origin.
 * All share a 24-unit box and 1.6 stroke so they sit on the same optical weight.
 */

import type { JSX } from 'react'

function Svg({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export const SearchIcon = (): JSX.Element => (
  <Svg>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Svg>
)

export const BookIcon = (): JSX.Element => (
  <Svg>
    <path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z" />
    <path d="M4 19a2 2 0 0 1 2-2h13" />
  </Svg>
)

/**
 * "DPS", set as type.
 *
 * A three-letter label rather than a glyph: no weapon silhouette says
 * damage-per-second, and at 18px the ones that try are unreadable anyway.
 * Drawn in an SVG so it inherits `currentColor` with the other rail icons.
 */
export const DpsIcon = (): JSX.Element => (
  <svg width="22" height="18" viewBox="0 0 30 18" fill="none" aria-hidden="true">
    <text
      x="15"
      y="13"
      textAnchor="middle"
      fill="currentColor"
      fontSize="12"
      fontWeight="700"
      letterSpacing="0.4"
      fontFamily="ui-sans-serif, system-ui, 'Segoe UI', sans-serif"
    >
      DPS
    </text>
  </svg>
)

/**
 * A stack of coins.
 *
 * Drawn as separate discs with a gap between them rather than one cylinder —
 * a continuous side wall is the universal database symbol, and that is exactly
 * what an earlier version of this read as.
 */
export const CoinsIcon = (): JSX.Element => (
  <Svg>
    <ellipse cx="12" cy="6" rx="6.5" ry="2.6" />
    <path d="M5.5 6v2.4c0 1.44 2.91 2.6 6.5 2.6s6.5-1.16 6.5-2.6V6" />
    <path d="M5.5 11.4v2.4c0 1.44 2.91 2.6 6.5 2.6s6.5-1.16 6.5-2.6v-2.4" />
    <path d="M5.5 16.8v2.4c0 1.44 2.91 2.6 6.5 2.6s6.5-1.16 6.5-2.6v-2.4" />
  </Svg>
)

/** A trophy, for the hiscores. */
export const TrophyIcon = (): JSX.Element => (
  <Svg>
    <path d="M7 4h10v5a5 5 0 0 1-10 0z" />
    <path d="M7 5.5H4.5v1.5a3 3 0 0 0 3 3" />
    <path d="M17 5.5h2.5V7a3 3 0 0 1-3 3" />
    <path d="M12 14v3.5" />
    <path d="M8.5 20.5h7l-.8-3h-5.4z" />
  </Svg>
)

export const UserIcon = (): JSX.Element => (
  <Svg>
    <circle cx="12" cy="8" r="4" />
    <path d="M5 20a7 7 0 0 1 14 0" />
  </Svg>
)

export const CalculatorIcon = (): JSX.Element => (
  <Svg>
    <rect x="5" y="3" width="14" height="18" rx="2" />
    <path d="M8 7h8" />
    <path d="M9 12h.01M12 12h.01M15 12h.01M9 16h.01M12 16h.01M15 16h.01" />
  </Svg>
)

/**
 * Settings, as sliders.
 *
 * Two gear attempts read badly at 18px: a spoked circle looked like a
 * brightness control, and a toothed one turned to mush. Sliders survive the
 * size — three horizontal rules with offset handles stay legible as strokes,
 * and they say "adjust things" at least as clearly as a cog does.
 */
export const GearIcon = (): JSX.Element => (
  <Svg>
    <path d="M4 7h10M18 7h2M4 12h3M11 12h9M4 17h7M15 17h5" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="9" cy="12" r="2" />
    <circle cx="13" cy="17" r="2" />
  </Svg>
)

/** Parchment: a page, for the tan reading theme. */
export const PageIcon = (): JSX.Element => (
  <Svg>
    <path d="M6 3.5h7.5L18 8v12.5H6z" />
    <path d="M13.5 3.5V8H18" />
  </Svg>
)

/** Light mode. The old "gear", finally doing the job it always looked like. */
export const SunIcon = (): JSX.Element => (
  <Svg>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9 6.7 6.7M17.3 17.3l1.8 1.8M19.1 4.9 17.3 6.7M6.7 17.3l-1.8 1.8" />
  </Svg>
)

/** Dark mode. */
export const MoonIcon = (): JSX.Element => (
  <Svg>
    <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5" />
  </Svg>
)

export const BackIcon = (): JSX.Element => (
  <Svg>
    <path d="m14 6-6 6 6 6" />
  </Svg>
)

export const ForwardIcon = (): JSX.Element => (
  <Svg>
    <path d="m10 6 6 6-6 6" />
  </Svg>
)

export const CloseIcon = (): JSX.Element => (
  <Svg>
    <path d="m7 7 10 10M17 7 7 17" />
  </Svg>
)
