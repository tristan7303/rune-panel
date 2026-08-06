/**
 * Headless title-index sync, run with `--sync-titles`.
 *
 * The point is observability: it prints the live phase, the request count and
 * the effective rate, so you can watch the client stay inside its own ceiling
 * instead of trusting that it does. `--dry-run` stops after the first page of
 * each phase, which is enough to prove the pagination and the response shapes
 * without pulling 150 requests.
 *
 * Writes with `writeSync` for the same reason smoke.ts does: `app.exit` tears
 * the process down without draining Node's async stdout queue.
 */

import { app } from 'electron'
import { writeSync } from 'fs'
import * as client from './wiki/client'
import * as titles from './wiki/titles'
import * as sync from './wiki/sync'
import * as db from './db'

function out(line: string): void {
  try {
    writeSync(1, line + '\n')
  } catch {
    /* no console attached; the exit code still reports */
  }
}

/**
 * Headless crawl, run with `--crawl`.
 *
 * The same code path the app runs while its window is closed, just observable.
 * There is no window here, so the crawler never sees itself as paused.
 */
export async function runCrawlCli(): Promise<void> {
  const startedAt = Date.now()
  const before = sync.getState()

  out('')
  out('══════════════════════════════════════════════════════')
  out('  BACKGROUND CRAWL  ·  rune-buddy')
  out('══════════════════════════════════════════════════════')
  out(`  cached       ${before.cached} pages (${before.stale} stale)`)
  out('──────────────────────────────────────────────────────')

  let lastPhase = ''
  const off = sync.onProgress((s) => {
    if (s.phase !== lastPhase) {
      if (lastPhase) out('')
      lastPhase = s.phase
      out(`  ${s.phase}`)
    }
    try {
      writeSync(1, `\r    ${s.done} fetched · ${s.remaining} queued · ${s.cached} cached   `)
    } catch {
      /* ignore */
    }
  })

  await sync.run()
  off()

  const after = sync.getState()
  const stats = client.getStats()
  const elapsed = (Date.now() - startedAt) / 1000

  out('')
  out('──────────────────────────────────────────────────────')
  out(`  fetched      ${after.done}`)
  out(`  cached       ${after.cached}  (+${after.cached - before.cached})`)
  out(`  still stale  ${after.stale}`)
  out(`  requests     ${stats.sent}  (${stats.retried} retried, ${stats.failed} failed)`)
  out(`  elapsed      ${elapsed.toFixed(1)}s  ·  ${(stats.sent / elapsed).toFixed(2)} req/s average`)
  out('══════════════════════════════════════════════════════')
  out('')

  db.close()
  app.exit(after.phase === 'error' ? 1 : 0)
}

export async function runSyncCli(): Promise<void> {
  const startedAt = Date.now()
  const before = titles.state()
  const dryRun = process.argv.includes('--dry-run')

  out('')
  out('══════════════════════════════════════════════════════')
  out(`  TITLE INDEX SYNC  ·  rune-buddy${dryRun ? '  ·  DRY RUN' : ''}`)
  out('══════════════════════════════════════════════════════')
  out(`  user-agent   ${client.userAgent()}`)
  out(`  existing     ${before.count} titles (${before.redirects} redirects)`)
  out(
    `  last synced  ${before.syncedAt ? new Date(before.syncedAt).toISOString() : 'never'}`
  )
  out('──────────────────────────────────────────────────────')

  let lastPhase = ''
  const off = titles.onProgress((p) => {
    // One line per phase change, then a rewritten counter — a line per batch
    // would bury the result under 150 rows of noise.
    if (p.phase !== lastPhase) {
      if (lastPhase) out('')
      lastPhase = p.phase
      out(`  ${p.phase}`)
    }
    const elapsed = (Date.now() - startedAt) / 1000
    const rate = elapsed > 0 ? (p.requests / elapsed).toFixed(2) : '0.00'
    try {
      writeSync(1, `\r    ${p.fetched} titles · ${p.requests} requests · ${rate} req/s   `)
    } catch {
      /* ignore */
    }
  })

  let failed = false
  try {
    // Two pages per phase on a dry run: enough to prove that continuation works
    // and the response shapes parse, without pulling the full 150 requests.
    await titles.sync('interactive', dryRun ? { maxPagesPerPhase: 2 } : {})
  } catch (err) {
    failed = true
    out('')
    out(`  ERROR  ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    off()
  }

  const after = titles.state()
  const stats = client.getStats()
  const elapsed = (Date.now() - startedAt) / 1000

  out('')
  out('──────────────────────────────────────────────────────')
  out(`  titles       ${after.count}  (${after.count - before.count >= 0 ? '+' : ''}${after.count - before.count})`)
  out(`  redirects    ${after.redirects}`)
  out(`  articles     ${after.count - after.redirects}`)
  out(`  requests     ${stats.sent}  (${stats.retried} retried, ${stats.failed} failed)`)
  out(`  elapsed      ${elapsed.toFixed(1)}s  ·  ${(stats.sent / elapsed).toFixed(2)} req/s average`)
  if (dryRun) out('  note         dry run: capped at 2 pages per phase, nothing pruned')
  out('══════════════════════════════════════════════════════')
  out('')

  db.close()
  app.exit(failed || stats.failed > 0 ? 1 : 0)
}
