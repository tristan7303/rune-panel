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

export function ToolPane({ id, arg }: { id: ToolId; arg?: string }): JSX.Element {
  const slotRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const slot = slotRef.current
    if (!slot) return

    const publish = (): void => {
      const r = slot.getBoundingClientRect()
      window.rp.setPaneBounds({ x: r.x, y: r.y, width: r.width, height: r.height })
    }

    publish()
    window.rp.showTool(id, arg)

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
  }, [id, arg])

  return <div className="tool-slot" ref={slotRef} />
}
