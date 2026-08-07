/**
 * First run.
 *
 * The app is close to useless before the title index exists — search finds
 * nothing and the failure looks like a bug rather than a missing download. So
 * the first launch asks for the download explicitly and shows what it is doing,
 * instead of starting silently in the background and hoping you do not try to
 * search in the next four minutes.
 *
 * Two steps:
 *
 *  1. The title index. Required — nothing works without it.
 *  2. Item prices. Two requests; makes item pages show a price immediately.
 *
 * There used to be a third, a seed crawl of the core pages, and it is gone from
 * here on purpose. It was never required — every page it fetched would have been
 * fetched on demand anyway — and it was forty-odd requests standing between an
 * installer and a usable app. On a slow or flaky connection that is where a
 * first run appears to hang, having already downloaded everything that mattered.
 *
 * The crawl still happens; it just happens afterwards, in the background, where
 * it already parks itself whenever the window is open. Nobody waits for it.
 *
 * Each step reports into one progress figure, weighted by how long it actually
 * takes rather than by step count — a bar that sits at 50% for four minutes and
 * then races to 100% is worse than no bar.
 */

import * as db from './db'
import * as titles from './wiki/titles'
import * as ge from './prices/ge'
import * as sync from './wiki/sync'
import type { SetupProgress, SetupStep } from '../shared/ipc'

/**
 * Share of the bar each step owns, from measured durations: the index is ~240s
 * and prices ~3s, so the index is very nearly the whole of it.
 */
const WEIGHTS: Record<SetupStep, number> = { titles: 0.98, prices: 0.02, done: 0 }
/** Requests the title index takes, for turning its count into a fraction. */
const TITLE_REQUESTS = 900

let running = false
let progress: SetupProgress = { step: 'titles', percent: 0, detail: '', running: false, done: false }

type Listener = (progress: SetupProgress) => void
const listeners = new Set<Listener>()

export function onProgress(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** True when the app has never been set up — the only thing that gates the wizard. */
export function isFirstRun(): boolean {
  return titles.state().count === 0
}

export function getProgress(): SetupProgress {
  return { ...progress, running, done: !isFirstRun() && !running }
}

function emit(step: SetupStep, within: number, detail: string): void {
  // Everything before this step, plus this step's share of its own progress.
  const order: SetupStep[] = ['titles', 'prices']
  const before = order.slice(0, order.indexOf(step)).reduce((sum, s) => sum + WEIGHTS[s], 0)
  const percent = Math.min(100, Math.round((before + WEIGHTS[step] * Math.min(within, 1)) * 100))

  progress = { step, percent, detail, running: true, done: false }
  for (const listener of listeners) listener(getProgress())
}

export async function run(options: { prices: boolean }): Promise<void> {
  if (running) return
  running = true

  const offTitles = titles.onProgress((p) => {
    emit('titles', p.requests / TITLE_REQUESTS, `${p.fetched.toLocaleString()} page names`)
  })

  try {
    emit('titles', 0, 'Starting…')
    await titles.sync('interactive')
    offTitles()

    if (options.prices) {
      emit('prices', 0, 'Item list and prices')
      await ge.syncMapping()
      await ge.syncLatest(true)
      emit('prices', 1, 'Prices ready')
    }

    db.kvSet('setup.completed_at', Date.now())
    progress = { step: 'done', percent: 100, detail: 'Ready', running: false, done: true }

    // The crawl the wizard used to run, started rather than awaited. It parks
    // itself while the window is open, so in practice it begins the first time
    // the panel is closed — which is exactly when nobody is waiting on it.
    void sync.run().catch((err: unknown) => {
      console.warn('[setup] seed crawl failed:', err instanceof Error ? err.message : err)
    })
  } catch (err) {
    // A partial index is still useful, so this reports rather than unwinds.
    progress = {
      step: progress.step,
      percent: progress.percent,
      detail: err instanceof Error ? err.message : String(err),
      running: false,
      done: false,
      error: true,
    }
  } finally {
    offTitles()
    running = false
    for (const listener of listeners) listener(getProgress())
  }
}
