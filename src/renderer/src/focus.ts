/**
 * Which box the caret goes in.
 *
 * Two triggers want this: opening the panel with the hotkey, and arriving on a
 * page that has a search box. Both are asking the same question — "what is the
 * thing you would type into here?" — and neither the window nor the router
 * knows the answer, because the input belongs to whichever route is mounted.
 *
 * So the route registers its own input and this picks between it and the header
 * wiki search. A registry rather than `autoFocus` because `autoFocus` fires on
 * mount and nothing here remounts: the window is created once at launch and
 * only ever hidden, so React never runs a mount when you press the hotkey.
 */

import { useEffect, useRef, type RefObject } from 'react'

/** The current route's own input, when it has one. */
let pageInput: HTMLInputElement | null = null
/** The header wiki search, which every route falls back to. */
let searchInput: HTMLInputElement | null = null
let programmatic = false

/**
 * Register this route's input for as long as the component is mounted.
 *
 * The unregister is identity-checked. React can mount the incoming route's
 * input before unmounting the outgoing one, and a blind `= null` on the way out
 * would throw away the registration that just replaced it.
 */
export function usePrimaryInput(): RefObject<HTMLInputElement | null> {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    pageInput = ref.current
    return () => {
      if (pageInput === ref.current) pageInput = null
    }
  })
  return ref
}

/** Register the header search as the fallback. One caller, for its lifetime. */
export function useSearchInput(ref: RefObject<HTMLInputElement | null>): void {
  useEffect(() => {
    searchInput = ref.current
    return () => {
      if (searchInput === ref.current) searchInput = null
    }
  })
}

/**
 * Whether the focus currently landing was ours rather than the user's.
 *
 * The header search opens its results dropdown on focus, which is right when
 * you click it and wrong when the window merely reappeared — you would be
 * looking at the results of a search you ran yesterday.
 */
export function isProgrammatic(): boolean {
  return programmatic
}

/**
 * Put the caret where typing should go.
 *
 * `pageOnly` for routes where the fallback would be worse than nothing: on a
 * tool route the embedded pane holds focus, and pulling it into the wiki search
 * because the profile you were reading has no input of its own is not a
 * kindness.
 *
 * Existing text is selected rather than left alone, so the next keystroke
 * replaces last session's query instead of appending to it.
 */
export function focusPrimary(opts?: { pageOnly?: boolean }): void {
  const el = opts?.pageOnly ? pageInput : (pageInput ?? searchInput)
  if (!el) return
  programmatic = true
  try {
    el.focus({ preventScroll: true })
    el.select()
  } finally {
    // The focus event is dispatched synchronously by `focus()`, so handlers
    // have already run by here. The microtask is belt and braces for anything
    // that defers.
    queueMicrotask(() => {
      programmatic = false
    })
  }
}
