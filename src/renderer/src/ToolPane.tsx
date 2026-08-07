/**
 * Host for the embedded browser pane.
 *
 * A `WebContentsView` lives outside the DOM and always composites above it, so
 * it cannot be positioned by CSS — this component measures where the content
 * area ended up and tells main, then hides the pane again on unmount.
 *
 * The consequence worth remembering: while a tool is showing, the pane covers
 * that rectangle completely. Nothing the renderer draws there will be seen —
 * which is why overlays get the freeze-frame treatment below.
 */

import { useEffect, useRef, useState, type JSX } from 'react'
import type { ToolId } from '@shared/ipc'
import { useStore } from './store'

export function ToolPane({ id, arg }: { id: ToolId; arg?: string }): JSX.Element {
  const slotRef = useRef<HTMLDivElement>(null)
  const overlaysOpen = useStore((s) => s.overlays) > 0
  /** A still of the pane, standing in for it while an overlay is open. */
  const [freeze, setFreeze] = useState<string | null>(null)
  /**
   * The pane is not shown until its page has loaded and been themed — which is
   * what stopped the unstyled flash, and leaves a second of empty slot in its
   * place. Main says when that window opens and closes.
   */
  const [loading, setLoading] = useState(false)

  useEffect(() => window.rp.onPaneLoading(setLoading), [])

  // Where the pane goes, published before it is ever shown. Bounds are
  // window-relative, so anything that moves the slot invalidates them: window
  // resize, and the rail or top bar changing size.
  useEffect(() => {
    const slot = slotRef.current
    if (!slot) return

    const publish = (): void => {
      const r = slot.getBoundingClientRect()
      window.rp.setPaneBounds({ x: r.x, y: r.y, width: r.width, height: r.height })
    }

    publish()
    const observer = new ResizeObserver(publish)
    observer.observe(slot)
    window.addEventListener('resize', publish)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', publish)
    }
  }, [])

  /**
   * Overlays get a photograph, not a hole.
   *
   * The pane must stand down while a dropdown is open — it composites above
   * the DOM, so the dropdown is invisible under it. But both earlier answers
   * were the wrong kind of visible: shrinking the pane relayouted the website
   * inside it, and hiding it outright blanked the page you were reading.
   *
   * So the pane is photographed first, the still is laid into the slot at the
   * same pixels, and only then does the real view hide. The page appears to
   * stay exactly where it was — frozen for the moment the dropdown is up,
   * which is the moment you are not interacting with it anyway — and the
   * dropdown draws over the still like any other DOM.
   *
   * The still lingers briefly after the overlay closes so the real pane is
   * back on screen before its stand-in leaves; the reverse order opens a gap.
   */
  useEffect(() => {
    let live = true

    if (!overlaysOpen) {
      window.rp.showTool(id, arg)
      const linger = window.setTimeout(() => {
        if (live) setFreeze(null)
      }, 120)
      return () => {
        live = false
        window.clearTimeout(linger)
      }
    }

    void window.rp.capturePane().then((still) => {
      if (!live) return
      if (still) setFreeze(still)
      // A beat for the still to paint before the real thing vanishes. Without
      // it the swap shows one frame of bare surface between the two.
      window.setTimeout(() => {
        if (live) window.rp.hideTool()
      }, 30)
    })
    return () => {
      live = false
    }
  }, [id, arg, overlaysOpen])

  // Critical: leaving the pane visible after unmount would cover whatever
  // route comes next, with no way to click past it.
  useEffect(() => () => window.rp.hideTool(), [])

  return (
    <div className="tool-slot" ref={slotRef}>
      {freeze && <img className="tool-freeze" src={freeze} alt="" draggable={false} />}
      {/* Not while a still is up: the page is already on screen, frozen, and a
          spinner over it would claim otherwise. */}
      {loading && !freeze && (
        <div className="tool-loading" role="status" aria-label="Loading">
          <span className="tool-spinner" />
        </div>
      )}
    </div>
  )
}
