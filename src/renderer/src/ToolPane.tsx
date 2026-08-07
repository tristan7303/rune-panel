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
import { useStore } from './store'

export function ToolPane({ id, arg }: { id: ToolId; arg?: string }): JSX.Element {
  /**
   * Hand the top of the stack to the interface while an overlay is open.
   *
   * The pane sits above the interface so that clicks reach the website. That
   * also means a dropdown drawn in the DOM would be behind it — so for as long
   * as one is up, the order is swapped. The pane keeps its rectangle either
   * way; nothing moves, which is the point.
   */
  const slotRef = useRef<HTMLDivElement>(null)
  const overlays = useStore((s) => s.overlays)

  const overlaysOpen = useStore((s) => s.overlays) > 0
  useEffect(() => {
    window.rp.setOverlayOpen(overlaysOpen)
    // Dropped back on unmount too: leaving the interface raised would make the
    // next pane unclickable.
    return () => window.rp.setOverlayOpen(false)
  }, [overlaysOpen])

  useEffect(() => {
    const slot = slotRef.current
    if (!slot) return

    const publish = (): void => {
      const r = slot.getBoundingClientRect()
      const bounds = { x: r.x, y: r.y, width: r.width, height: r.height }
      window.rp.setPaneBounds(bounds)
    }

    publish()
    // Only vanish outright if there is no room left to shrink into; otherwise
    // the page stays on screen beside the overlay.
    const r = slot.getBoundingClientRect()
    const bounds = { x: r.x, y: r.y, width: r.width, height: r.height }
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
  }, [id, arg, overlays])

  return <div className="tool-slot" ref={slotRef} />
}

