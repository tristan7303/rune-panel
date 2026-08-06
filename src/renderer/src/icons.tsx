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

export const GearIcon = (): JSX.Element => (
  <Svg>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" />
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
