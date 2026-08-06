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
import { SearchIcon } from './icons'

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey
      if (mod && (e.key === 'f' || e.key === 'k')) {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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
        {!query && <kbd className="search-hint">Ctrl F</kbd>}
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
