/**
 * Notes.
 *
 * The one place in this app that stores something the user made. Everything
 * else on disk is a copy of the wiki and can be deleted without loss; a note
 * cannot, which is what shapes the decisions here.
 *
 * Writes go straight through to SQLite on every autosave rather than being
 * batched in memory and flushed on quit. A note is a few kilobytes and the
 * database is local, so the write is not worth deferring — and deferring it is
 * exactly how an editor loses an afternoon's work to a crash it could have
 * survived. The renderer debounces so that typing does not write per keystroke;
 * that is a rate limit, not a buffer, and the last debounce is flushed when the
 * note is left.
 */

import * as db from './db'

export interface Note {
  id: number
  title: string
  /** Markdown. Empty for a note that has only ever been named. */
  body: string
  position: number
  createdAt: number
  updatedAt: number
}

/** A note in the sidebar list, without the body it would be wasteful to send. */
export interface NoteSummary {
  id: number
  title: string
  position: number
  updatedAt: number
  /** Whether deleting it should ask first. */
  hasContent: boolean
}

/** Distance between notes when appending, leaving room to insert between. */
const POSITION_STEP = 1024

interface Row {
  id: number
  title: string
  body: string
  position: number
  created_at: number
  updated_at: number
}

const toNote = (row: Row): Note => ({
  id: row.id,
  title: row.title,
  body: row.body,
  position: row.position,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

export function list(): NoteSummary[] {
  const rows = db
    .get()
    .prepare(
      `SELECT id, title, position, updated_at, LENGTH(TRIM(body)) AS len
       FROM notes ORDER BY position`
    )
    .all() as Array<{ id: number; title: string; position: number; updated_at: number; len: number }>

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    position: r.position,
    updatedAt: r.updated_at,
    hasContent: r.len > 0,
  }))
}

export function read(id: number): Note | null {
  const row = db.get().prepare('SELECT * FROM notes WHERE id = ?').get(id) as Row | undefined
  return row ? toNote(row) : null
}

export function create(title = 'Untitled'): Note {
  const now = Date.now()
  const last = db.get().prepare('SELECT MAX(position) AS max FROM notes').get() as {
    max: number | null
  }
  const position = (last.max ?? 0) + POSITION_STEP

  const row = db
    .get()
    .prepare(
      `INSERT INTO notes (title, body, position, created_at, updated_at)
       VALUES (?, '', ?, ?, ?) RETURNING *`
    )
    .get(title.trim() || 'Untitled', position, now, now) as unknown as Row

  return toNote(row)
}

/**
 * Save whatever changed.
 *
 * `updated_at` moves only when something actually did. The autosave fires on a
 * timer after typing stops, and a save that rewrites the same bytes would still
 * bump the timestamp — which is the number the sidebar sorts and reports by, so
 * simply opening a note would appear to edit it.
 */
export function update(id: number, patch: { title?: string; body?: string }): Note | null {
  const current = read(id)
  if (!current) return null

  const title = patch.title === undefined ? current.title : patch.title.trim() || 'Untitled'
  const body = patch.body ?? current.body
  if (title === current.title && body === current.body) return current

  const row = db
    .get()
    .prepare('UPDATE notes SET title = ?, body = ?, updated_at = ? WHERE id = ? RETURNING *')
    .get(title, body, Date.now(), id) as Row | undefined

  return row ? toNote(row) : null
}

export function remove(id: number): void {
  db.get().prepare('DELETE FROM notes WHERE id = ?').run(id)
}

/**
 * Move a note to sit between two others.
 *
 * Positions are REAL and sparse so this is one row's write: the midpoint of its
 * new neighbours. Renumbering the whole list on every drag would be simpler to
 * read and would rewrite every row each time a note moved one place.
 */
export function move(id: number, before: number | null, after: number | null): void {
  const low = before ?? (after === null ? 0 : after - POSITION_STEP * 2)
  const high = after ?? low + POSITION_STEP * 2
  db.get()
    .prepare('UPDATE notes SET position = ? WHERE id = ?')
    .run((low + high) / 2, id)
}
