/**
 * SQLite storage.
 *
 * `node:sqlite` rather than better-sqlite3: Electron 43 bundles Node 24, where
 * it is stable and built in. That removes a native module and everything that
 * comes with one — electron-rebuild, ABI mismatches on upgrade, and a working
 * C++ toolchain on any machine that clones this.
 */

import { DatabaseSync } from 'node:sqlite'
import { app } from 'electron'
import { join } from 'path'

let db: DatabaseSync | null = null

/**
 * Schema migrations, applied in order. The array index is the version the
 * database is at *before* the entry runs, so entry 0 takes a fresh file to
 * version 1. Never edit a shipped entry — append a new one.
 */
const MIGRATIONS: string[] = [
  `
  -- The instant-search index: every content-namespace title, redirects
  -- included. WITHOUT ROWID because every access is a lookup by the text key
  -- and the rows are tiny, so the extra b-tree indirection is pure overhead.
  CREATE TABLE titles (
    title       TEXT    PRIMARY KEY,
    is_redirect INTEGER NOT NULL DEFAULT 0,
    -- Where a redirect points. NULL for articles, and for the occasional
    -- redirect whose target the API declines to resolve.
    target      TEXT,
    synced_at   INTEGER NOT NULL
  ) WITHOUT ROWID;

  -- Lets search collapse the dozen aliases an OSRS page accumulates into one
  -- result. Partial, because most rows are articles with no target at all.
  CREATE INDEX titles_target ON titles(target) WHERE target IS NOT NULL;

  -- Rendered article bodies. Kept on the rowid table deliberately: these rows
  -- carry hundreds of KB of HTML, which is exactly what WITHOUT ROWID is bad at.
  CREATE TABLE pages (
    title      TEXT PRIMARY KEY,
    revid      INTEGER NOT NULL,
    html       TEXT    NOT NULL,
    infobox    TEXT,
    sections   TEXT,
    categories TEXT,
    fetched_at INTEGER NOT NULL,
    stale      INTEGER NOT NULL DEFAULT 0
  );

  -- The crawler's work queue is "everything marked stale", which is almost
  -- always a tiny slice of the table.
  CREATE INDEX pages_stale ON pages(stale) WHERE stale = 1;

  -- Bytes live on disk under userData/images; this only tracks what we have.
  CREATE TABLE images (
    name       TEXT PRIMARY KEY,
    ext        TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
  ) WITHOUT ROWID;

  CREATE TABLE items (
    id        INTEGER PRIMARY KEY,
    name      TEXT    NOT NULL,
    examine   TEXT,
    members   INTEGER NOT NULL DEFAULT 0,
    buy_limit INTEGER,
    value     INTEGER,
    highalch  INTEGER,
    icon      TEXT
  );

  CREATE INDEX items_name ON items(name);

  CREATE TABLE prices (
    item_id    INTEGER PRIMARY KEY,
    high       INTEGER,
    high_time  INTEGER,
    low        INTEGER,
    low_time   INTEGER,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE price_series (
    item_id  INTEGER NOT NULL,
    ts       INTEGER NOT NULL,
    avg_high INTEGER,
    avg_low  INTEGER,
    vol_high INTEGER,
    vol_low  INTEGER,
    PRIMARY KEY (item_id, ts)
  ) WITHOUT ROWID;

  -- Sync cursors and last-refresh stamps.
  CREATE TABLE kv (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  ) WITHOUT ROWID;
  `,

  // The internal URL scheme changed, so every cached page holds links and image
  // sources the app no longer answers to. The HTML has to be rebuilt from the
  // wiki rather than patched — the transform is the only thing that knows the
  // full shape of what it emits.
  //
  // Only `pages` and `images` are dropped. `titles` survives deliberately: it
  // holds no URLs, and rebuilding it is ~880 requests over four minutes.
  `
  DELETE FROM pages;
  DELETE FROM images;
  DELETE FROM kv WHERE key = 'sync.recentchanges_at';
  `,
]

export function open(): DatabaseSync {
  if (db) return db

  db = new DatabaseSync(join(app.getPath('userData'), 'rune-panel.db'))

  // WAL so a background crawl writing pages never blocks a read the UI is
  // waiting on. NORMAL synchronous is the standard companion: under WAL it
  // risks only the last transaction on an OS crash, never corruption, and it
  // is the difference between a title sync taking seconds and taking minutes.
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA synchronous = NORMAL')

  migrate(db)
  return db
}

export function get(): DatabaseSync {
  if (!db) throw new Error('database not open — call open() during app startup')
  return db
}

export function close(): void {
  db?.close()
  db = null
}

function migrate(d: DatabaseSync): void {
  const row = d.prepare('PRAGMA user_version').get() as { user_version: number } | undefined
  const from = row?.user_version ?? 0

  for (let version = from; version < MIGRATIONS.length; version++) {
    d.exec('BEGIN')
    try {
      d.exec(MIGRATIONS[version])
      // Interpolated because PRAGMA does not accept bound parameters. The value
      // is a loop index, never user input.
      d.exec(`PRAGMA user_version = ${version + 1}`)
      d.exec('COMMIT')
    } catch (err) {
      d.exec('ROLLBACK')
      throw new Error(
        `migration ${version} failed: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }
}

// ── kv helpers ──────────────────────────────────────────────────────────────

export function kvGet(key: string): string | null {
  const row = get().prepare('SELECT value FROM kv WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

export function kvGetNumber(key: string): number | null {
  const raw = kvGet(key)
  if (raw === null) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

export function kvSet(key: string, value: string | number): void {
  get()
    .prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?')
    .run(key, String(value), String(value))
}
