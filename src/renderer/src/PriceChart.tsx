/**
 * Price history, as inline SVG.
 *
 * Hand-drawn rather than a charting library: this is two lines and a crosshair,
 * and the smallest credible library is larger than the whole renderer bundle.
 *
 * Two decisions worth recording, because both are easy to get wrong by eye:
 *
 * **The series colours were computed, not chosen.** The app's own violet and
 * cyan accents fail as a categorical pair — ΔE 3.6 under deuteranopia and 11.9
 * under normal vision, well below the floor of 15. Two hues that look distinct
 * to me are not distinct to everyone. The blue/amber pair below clears every
 * check in both themes: CVD separation ≥ 20, contrast ≥ 3:1, inside the
 * lightness band for its surface.
 *
 * **One axis.** Volume is a different measure at a different scale, so it gets
 * its own panel underneath rather than a second y-scale on the same plot.
 */

import { useMemo, useRef, useState, type JSX } from 'react'
import type { GeSeriesPoint, Theme } from '@shared/ipc'

/**
 * Series colours, per theme.
 *
 * Validated with the palette checker rather than picked. Kept here rather than
 * in CSS because the SVG needs the literal values for strokes and gradients,
 * and a var() indirection would put them beyond the validator's reach.
 */
export const SERIES = {
  dark: { buy: '#3d92d8', sell: '#c8821f' },
  light: { buy: '#1f6fb5', sell: '#9a6210' },
} as const

/**
 * Which validated palette a theme uses.
 *
 * Parchment is a light surface, so it takes the light steps — the checks that
 * passed them were run against a light background, and the darker pair would
 * fail contrast on tan just as it does on white.
 */
export function chartMode(theme: Theme): 'dark' | 'light' {
  return theme === 'dark' ? 'dark' : 'light'
}

const PAD = { top: 12, right: 62, bottom: 22, left: 8 }
const HEIGHT = 190
const VOLUME_HEIGHT = 46

interface Hover {
  index: number
  x: number
}

export function PriceChart({
  series,
  theme,
}: {
  series: GeSeriesPoint[]
  theme: Theme
}): JSX.Element | null {
  const [width, setWidth] = useState(720)
  const [hover, setHover] = useState<Hover | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const colors = SERIES[chartMode(theme)]

  // Points with no trades in the bucket carry null prices; they would otherwise
  // draw a line down to zero.
  const points = useMemo(
    () => series.filter((p) => p.avgHigh !== null || p.avgLow !== null),
    [series]
  )

  const geometry = useMemo(() => {
    if (points.length < 2) return null

    const values = points.flatMap((p) => [p.avgHigh, p.avgLow]).filter((v): v is number => v !== null)
    const min = Math.min(...values)
    const max = Math.max(...values)
    // A flat series would divide by zero; pad it so the line sits mid-plot.
    const span = max - min || Math.max(max * 0.02, 1)

    const plotW = width - PAD.left - PAD.right
    const plotH = HEIGHT - PAD.top - PAD.bottom

    const x = (i: number): number => PAD.left + (i / (points.length - 1)) * plotW
    const y = (v: number): number => PAD.top + plotH - ((v - min) / span) * plotH

    const line = (pick: (p: GeSeriesPoint) => number | null): string => {
      let d = ''
      let pen = false
      points.forEach((p, i) => {
        const v = pick(p)
        if (v === null) {
          // Break the path rather than interpolate across a gap in trading.
          pen = false
          return
        }
        d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)} `
        pen = true
      })
      return d.trim()
    }

    const maxVol = Math.max(...points.map((p) => p.volHigh + p.volLow), 1)

    return { min, max, span, plotW, plotH, x, y, line, maxVol }
  }, [points, width])

  // Measure once per layout rather than on every render.
  const measure = (node: SVGSVGElement | null): void => {
    if (!node) return
    svgRef.current = node
    const w = node.parentElement?.clientWidth ?? 720
    if (Math.abs(w - width) > 2) setWidth(w)
  }

  if (!geometry) {
    return <p className="chart-empty">No price history for this item.</p>
  }

  const { min, max, plotH, x, y, line, maxVol } = geometry
  const active = hover ? points[hover.index] : null

  const onMove = (e: React.MouseEvent<SVGSVGElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - rect.left
    const ratio = (px - PAD.left) / (width - PAD.left - PAD.right)
    const index = Math.round(ratio * (points.length - 1))
    if (index < 0 || index >= points.length) return setHover(null)
    setHover({ index, x: x(index) })
  }

  return (
    <figure className="chart">
      <figcaption className="chart-legend">
        {/* A legend is present because there are two series; identity is never
            carried by colour alone. */}
        <span>
          <i style={{ background: colors.buy }} /> Buy
        </span>
        <span>
          <i style={{ background: colors.sell }} /> Sell
        </span>
        <span className="chart-range">
          {points.length} points · {fmt(min)} – {fmt(max)} gp
        </span>
      </figcaption>

      <svg
        ref={measure}
        className="chart-svg"
        viewBox={`0 0 ${width} ${HEIGHT + VOLUME_HEIGHT}`}
        width="100%"
        height={HEIGHT + VOLUME_HEIGHT}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label={`Price history: ${fmt(min)} to ${fmt(max)} gp over ${points.length} points`}
      >
        {/* Recessive gridlines — three, labelled at the right so they never
            collide with the plot. */}
        {[0, 0.5, 1].map((t) => {
          const gy = PAD.top + plotH * t
          const value = max - (max - min) * t
          return (
            <g key={t}>
              <line x1={PAD.left} x2={width - PAD.right} y1={gy} y2={gy} className="chart-grid" />
              <text x={width - PAD.right + 6} y={gy + 3.5} className="chart-tick">
                {fmt(value)}
              </text>
            </g>
          )
        })}

        <path d={line((p) => p.avgLow)} fill="none" stroke={colors.sell} strokeWidth="2" />
        <path d={line((p) => p.avgHigh)} fill="none" stroke={colors.buy} strokeWidth="2" />

        {/* Volume, on its own scale in its own panel — never a second y-axis. */}
        <g transform={`translate(0 ${HEIGHT})`}>
          {points.map((p, i) => {
            const total = p.volHigh + p.volLow
            const h = (total / maxVol) * (VOLUME_HEIGHT - 8)
            const barW = Math.max(1, (width - PAD.left - PAD.right) / points.length - 1)
            return (
              <rect
                key={p.ts}
                x={x(i) - barW / 2}
                y={VOLUME_HEIGHT - h - 4}
                width={barW}
                height={h}
                className="chart-volume"
              />
            )
          })}
        </g>

        {hover && active && (
          <g className="chart-hover">
            <line x1={hover.x} x2={hover.x} y1={PAD.top} y2={HEIGHT + VOLUME_HEIGHT - 4} />
            {active.avgHigh !== null && (
              <circle cx={hover.x} cy={y(active.avgHigh)} r="4" fill={colors.buy} />
            )}
            {active.avgLow !== null && (
              <circle cx={hover.x} cy={y(active.avgLow)} r="4" fill={colors.sell} />
            )}
          </g>
        )}
      </svg>

      {active && (
        <div className="chart-tip" style={{ left: `${(hover!.x / width) * 100}%` }}>
          <strong>{new Date(active.ts * 1000).toLocaleDateString()}</strong>
          <span>
            <i style={{ background: colors.buy }} /> {active.avgHigh ? fmt(active.avgHigh) : '—'}
          </span>
          <span>
            <i style={{ background: colors.sell }} /> {active.avgLow ? fmt(active.avgLow) : '—'}
          </span>
          <span className="chart-tip-vol">{(active.volHigh + active.volLow).toLocaleString()} traded</span>
        </div>
      )}
    </figure>
  )
}

/** Compact gp: 1.4b, 776k, 4,151. */
export function fmt(n: number): string {
  const v = Math.round(n)
  if (Math.abs(v) >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(2)}b`
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}m`
  if (Math.abs(v) >= 100_000) return `${Math.round(v / 1000)}k`
  return v.toLocaleString()
}
