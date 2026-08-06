/**
 * Experience and levels.
 *
 * Shared because both processes need it: main to enrich a hiscores lookup,
 * the renderer to show how far a level is. The table is computed once at load
 * from the game's own formula rather than pasted as 126 literals — the formula
 * is short, and a transcribed table is a silent-wrong-answer waiting to happen.
 *
 *   xp(n) = floor( (1/4) * sum_{i=1..n-1} floor(i + 300 * 2^(i/7)) )
 *
 * Levels run past 99 because the hiscores report total experience and players
 * talk in virtual levels; 126 is where the curve passes 200m, the per-skill cap.
 */

export const MAX_LEVEL = 99
export const MAX_VIRTUAL_LEVEL = 126
/** Per-skill experience cap. */
export const MAX_XP = 200_000_000

/** `XP_FOR_LEVEL[n]` is the experience needed to reach level n. Index 0 unused. */
export const XP_FOR_LEVEL: number[] = (() => {
  const table = [0, 0]
  let points = 0
  for (let level = 1; level < MAX_VIRTUAL_LEVEL; level++) {
    points += Math.floor(level + 300 * Math.pow(2, level / 7))
    table[level + 1] = Math.floor(points / 4)
  }
  return table
})()

/** The level a given experience total reaches, capped at 99. */
export function levelForXp(xp: number): number {
  return Math.min(virtualLevelForXp(xp), MAX_LEVEL)
}

/** The same, uncapped — what the level would be if the game kept counting. */
export function virtualLevelForXp(xp: number): number {
  let level = 1
  while (level < MAX_VIRTUAL_LEVEL && XP_FOR_LEVEL[level + 1] <= xp) level++
  return level
}

export interface Progress {
  level: number
  /** Level past 99, when the experience warrants one. */
  virtualLevel: number
  /** Experience still needed for the next level; null once nothing is left. */
  toNextLevel: number | null
  /** How far through the current level, 0-1. */
  fraction: number
  /** Experience still needed for 99; null at or past it. */
  toMax: number | null
}

export function progressForXp(xp: number): Progress {
  const virtual = virtualLevelForXp(xp)
  const level = Math.min(virtual, MAX_LEVEL)

  const start = XP_FOR_LEVEL[virtual] ?? 0
  const next = XP_FOR_LEVEL[virtual + 1]
  const span = next !== undefined ? next - start : 0

  return {
    level,
    virtualLevel: virtual,
    toNextLevel: next !== undefined && xp < next ? next - xp : null,
    // A capped skill is complete rather than at the start of a level that
    // cannot be reached.
    fraction: span > 0 ? Math.min((xp - start) / span, 1) : 1,
    toMax: xp < XP_FOR_LEVEL[MAX_LEVEL] ? XP_FOR_LEVEL[MAX_LEVEL] - xp : null,
  }
}

/** 1,234,567 -> "1.2m". Ranks and experience get long. */
export function shortNumber(n: number): string {
  if (n < 0) return '—'
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}b`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`
  if (n >= 10_000) return `${Math.round(n / 1000)}k`
  return n.toLocaleString()
}
