/**
 * Host for the embedded browser pane.
 *
 * Renders nothing visible. A `WebContentsView` lives outside the DOM and always
 * composites above it, so it cannot be positioned by CSS — this component's
 * only job is to measure where the content area ended up and tell main, then
 * hide the pane again on unmount.
 *
 * The consequence worth remembering: while a tool is showing, the pane covers
 * that rectangle completely. Nothing the renderer draws there will be seen.
 */

import { useEffect, useRef, type JSX } from 'react'
import type { ToolId } from '@shared/ipc'
import { useStore, type DOMRectLike } from './store'

export function ToolPane({ id, arg }: { id: ToolId; arg?: string }): JSX.Element {
  const slotRef = useRef<HTMLDivElement>(null)
  const overlays = useStore((s) => s.overlays)
  const overlayRect = useStore((s) => s.overlayRect)

  useEffect(() => {
    const slot = slotRef.current
    if (!slot) return

    const publish = (): void => {
      const r = slot.getBoundingClientRect()
      const bounds = avoiding({ x: r.x, y: r.y, width: r.width, height: r.height }, overlayRect)
      window.rp.setPaneBounds(bounds)
    }

    publish()
    // Only vanish outright if there is no room left to shrink into; otherwise
    // the page stays on screen beside the overlay.
    const r = slot.getBoundingClientRect()
    const bounds = avoiding({ x: r.x, y: r.y, width: r.width, height: r.height }, overlayRect)
    if (bounds.width > 120 && bounds.height > 120) window.rp.showTool(id, arg)
    else window.rp.hideTool()

    // Bounds are window-relative, so anything that moves the slot invalidates
    // them: window resize, and the rail or top bar changing size.
    const observer = new ResizeObserver(publish)
    observer.observe(slot)
    window.addEventListener('resize', publish)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', publish)
      // Critical: leaving the pane visible would cover whatever route comes
      // next, with no way to click past it.
      window.rp.hideTool()
    }
  }, [id, arg, overlays, overlayRect])

  return <div className="tool-slot" ref={slotRef} />
}

/**
 * Shrink a rectangle until it no longer overlaps another one.
 *
 * A WebContentsView composites above the DOM and cannot be layered beneath
 * anything, so an overlay drawn over the content area is simply invisible while
 * a tool is showing. Hiding the pane solves that but takes the whole page with
 * it, which is worse — you lose your place to read one menu.
 *
 * Instead the pane gives up the smallest slice that clears the overlay. Four
 * candidate insets, one per edge, ranked by area — but insets that move the
 * pane's origin are taken last even when they leave more room. Trimming the
 * bottom clips the page; shifting the left edge slides every element in it
 * sideways, which is far more disruptive for a few hundred pixels either way.
 */
function avoiding(slot: DOMRectLike, overlay: DOMRectLike | null): DOMRectLike {
  if (!overlay) return slot

  const slotRight = slot.x + slot.width
  const slotBottom = slot.y + slot.height
  const overRight = overlay.x + overlay.width
  const overBottom = overlay.y + overlay.height

  const overlaps =
    overlay.x < slotRight && overRight > slot.x && overlay.y < slotBottom && overBottom > slot.y
  if (!overlaps) return slot

  // A small margin so the pane's edge does not sit flush against the overlay.
  const pad = 8
  const candidates: Array<DOMRectLike & { shifts: boolean }> = [
    // Give up the bottom — clips, does not move anything.
    { x: slot.x, y: slot.y, width: slot.width, height: overlay.y - pad - slot.y, shifts: false },
    // Give up the right — likewise.
    { x: slot.x, y: slot.y, width: overlay.x - pad - slot.x, height: slot.height, shifts: false },
    // Give up the top: the origin moves down.
    { x: slot.x, y: overBottom + pad, width: slot.width, height: slotBottom - overBottom - pad, shifts: true },
    // Give up the left: the origin moves right.
    { x: overRight + pad, y: slot.y, width: slotRight - overRight - pad, height: slot.height, shifts: true },
  ]

  const usable = candidates.filter((c) => c.width > 140 && c.height > 140)
  if (usable.length === 0) return slot

  usable.sort((a, b) => {
    if (a.shifts !== b.shifts) return a.shifts ? 1 : -1
    return b.width * b.height - a.width * a.height
  })
  const { shifts: _shifts, ...best } = usable[0]
  return best
}
