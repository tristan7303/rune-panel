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

export const SwordIcon = (): JSX.Element => (
  <Svg>
    <path d="M14.5 3H20v5.5L10 18.5 5.5 14z" />
    <path d="m9 15-5 5" />
    <path d="m3 18 3 3" />
  </Svg>
)

export const CoinsIcon = (): JSX.Element => (
  <Svg>
    <ellipse cx="12" cy="6.5" rx="7" ry="3" />
    <path d="M5 6.5v11c0 1.7 3.1 3 7 3s7-1.3 7-3v-11" />
    <path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" />
  </Svg>
)

export const ChartIcon = (): JSX.Element => (
  <Svg>
    <path d="M4 20V10" />
    <path d="M10 20V4" />
    <path d="M16 20v-7" />
    <path d="M21 20H3" />
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
 * A real gear.
 *
 * The previous "gear" was a circle with eight radiating spokes, which reads as a
 * brightness control rather than settings — it now serves as exactly that (see
 * SunIcon). This one has actual teeth, drawn as a single closed path so the
 * silhouette holds together at 18px.
 */
export const GearIcon = (): JSX.Element => (
  <Svg>
    <path d="M10.3 3.2a1 1 0 0 1 1-.8h1.4a1 1 0 0 1 1 .8l.24 1.2a7.4 7.4 0 0 1 1.62.94l1.16-.4a1 1 0 0 1 1.2.45l.7 1.2a1 1 0 0 1-.2 1.25l-.92.8a7.5 7.5 0 0 1 0 1.87l.92.8a1 1 0 0 1 .2 1.25l-.7 1.2a1 1 0 0 1-1.2.45l-1.16-.4a7.4 7.4 0 0 1-1.62.94l-.24 1.2a1 1 0 0 1-1 .8h-1.4a1 1 0 0 1-1-.8l-.24-1.2a7.4 7.4 0 0 1-1.62-.94l-1.16.4a1 1 0 0 1-1.2-.45l-.7-1.2a1 1 0 0 1 .2-1.25l.92-.8a7.5 7.5 0 0 1 0-1.87l-.92-.8a1 1 0 0 1-.2-1.25l.7-1.2a1 1 0 0 1 1.2-.45l1.16.4a7.4 7.4 0 0 1 1.62-.94z" />
    <circle cx="12" cy="12" r="2.6" />
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
