/**
 * The wiki search box in the title bar.
 *
 * Always mounted, always in the same place. Search used to be a destination you
 * navigated *to*, which meant leaving whatever you were reading to look up the
 * next thing — a bad trade when looking things up is the entire point. Living
 * in the header makes it available from every view without costing a route.
 *
 * Ctrl+F and Ctrl+K both focus it. Ctrl+F because that is the reflex for "find
 * something" and this app has no in-page find to conflict with.
 */

import { useEffect, useRef, useState, type JSX } from 'react'
import type { SearchResult } from '@shared/ipc'
import { useNav } from './nav'
import { useStore } from './store'
import { SearchIcon } from './icons'

/**
 * A keybind written the way people write them — "Ctrl+F", "Alt+S" — turned into
 * something comparable against a KeyboardEvent.
 *
 * Deliberately forgiving about separators and case, and deliberately narrow
 * about what counts: a single character or a function key, with any of the
 * three usual modifiers. Anything it cannot parse yields null and the caller
 * falls back, so a mistyped setting loses the shortcut rather than the app.
 */
interface Combo {
  ctrl: boolean
  alt: boolean
  shift: boolean
  key: string
}

function parseCombo(spec: string): Combo | null {
  const parts = spec
    .split(/[+\-\s]+/)
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean)
  if (parts.length === 0) return null

  const combo: Combo = { ctrl: false, alt: false, shift: false, key: '' }
  for (const part of parts) {
    if (part === 'ctrl' || part === 'control' || part === 'cmd' || part === 'meta') combo.ctrl = true
    else if (part === 'alt' || part === 'option') combo.alt = true
    else if (part === 'shift') combo.shift = true
    else combo.key = part
  }
  if (!combo.key || (combo.key.length > 1 && !/^f\d{1,2}$/.test(combo.key))) return null
  return combo
}

function matches(combo: Combo, e: KeyboardEvent): boolean {
  return (
    combo.ctrl === (e.ctrlKey || e.metaKey) &&
    combo.alt === e.altKey &&
    combo.shift === e.shiftKey &&
    e.key.toLowerCase() === combo.key
  )
}

/** "Ctrl+F" -> "Ctrl F", for the hint chip. */
function prettyCombo(spec: string): string {
  return spec
    .split(/[+\-\s]+/)
    .filter(Boolean)
    .map((p) => (p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1)))
    .join(' ')
}

export function HeaderSearch(): JSX.Element {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [selected, setSelected] = useState(0)
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const push = useNav((s) => s.push)

  // Monotonic request id; only the newest reply paints. Search returns in about
  // 10ms but IPC replies can still land out of order.
  const latest = useRef(0)

  const searchKey = useStore((s) => s.settings?.searchKey ?? 'Ctrl+F')

  useEffect(() => {
    const combo = parseCombo(searchKey)
    const onKey = (e: KeyboardEvent): void => {
      // Ctrl+K stays wired regardless of the configured key: it is the near
      // universal palette shortcut and costs nothing to keep.
      const isDefault = (e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k'
      if (!isDefault && !(combo && matches(combo, e))) return
      e.preventDefault()
      inputRef.current?.focus()
      inputRef.current?.select()
      setOpen(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [searchKey])

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  useEffect(() => {
    const seq = ++latest.current
    if (query.trim().length < 2) {
      setResults([])
      setSelected(0)
      return
    }
    void window.rp.search(query).then((hits) => {
      if (seq !== latest.current) return
      setResults(hits)
      setSelected(0)
      setOpen(true)
    })
  }, [query])

  const open_ = (result: SearchResult): void => {
    push({ kind: 'page', title: result.title })
    setQuery('')
    setResults([])
    setOpen(false)
    inputRef.current?.blur()
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && results[selected]) {
      e.preventDefault()
      open_(results[selected])
    } else if (e.key === 'Escape') {
      // Clear the box first; only an already-empty box lets Escape reach the
      // window handler and close the app.
      if (query) {
        e.stopPropagation()
        setQuery('')
        setOpen(false)
      } else {
        inputRef.current?.blur()
      }
    }
  }

  const showing = open && results.length > 0

  return (
    <div className="header-search" ref={wrapRef}>
      <div className="search-field is-header">
        <SearchIcon />
        <input
          ref={inputRef}
          type="text"
          className="search-input"
          placeholder="Search the OSRS Wiki…"
          spellCheck={false}
          autoComplete="off"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        {!query && <kbd className="search-hint">{prettyCombo(searchKey)}</kbd>}
      </div>

      {showing && (
        <ul className="results header-results" role="listbox">
          {results.slice(0, 14).map((r, i) => (
            <li
              key={`${r.title}:${r.matchedVia ?? ''}`}
              role="option"
              aria-selected={i === selected}
              className={`result ${i === selected ? 'is-selected' : ''}`}
              onMouseEnter={() => setSelected(i)}
              onClick={() => open_(r)}
            >
              <span className="result-title">{r.title}</span>
              {r.matchedVia && <span className="result-alias">matched “{r.matchedVia}”</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
