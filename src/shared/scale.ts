/**
 * Ctrl+scroll, turned into whole steps of interface scale.
 *
 * Shared because two very different places need the same behaviour: the app's
 * own renderer, and the preload injected into every embedded page. A pane
 * composites above the DOM and owns its own input, so the app's listener never
 * sees a wheel that happened over GE Tracker — each side has to listen for
 * itself, and this is what keeps them from disagreeing about what a notch is.
 *
 * Deliberately not Electron's `zoom-changed`. That event exists for exactly
 * this gesture, but it fires from the browser's own zoom machinery, which then
 * also zooms whichever contents received it — leaving the app and the page
 * inside it drifting apart at different scales.
 */

/**
 * Wheel deltas are not one-notch-one-event. A mouse reports 100 or 120 per
 * detent depending on the platform, and a trackpad pinch arrives as a stream of
 * small fractions. Accumulating to a threshold covers both; the remainder is
 * dropped rather than carried, because carrying it makes a single detent
 * occasionally worth two steps, and one notch always meaning one step matters
 * more than the arithmetic being exact.
 */
const NOTCH = 50

export type ScaleDirection = 'in' | 'out'

/**
 * Watches wheel events and calls back once per notch, with nothing to clean up.
 * Returns a listener; the caller owns registration, because the two callers
 * attach to different objects.
 */
export function scaleOnWheel(step: (direction: ScaleDirection) => void): (event: WheelEvent) => void {
  let accumulated = 0

  return (event: WheelEvent): void => {
    if (!event.ctrlKey || event.deltaY === 0) return
    // Claim the gesture, or the browser zooms the page underneath as well and
    // the two scales compound.
    event.preventDefault()

    // A reversal is a new gesture, not a continuation of the old one.
    if (accumulated !== 0 && Math.sign(event.deltaY) !== Math.sign(accumulated)) accumulated = 0
    accumulated += event.deltaY
    if (Math.abs(accumulated) < NOTCH) return

    // Scrolling up is a negative delta and means larger, as it does everywhere.
    step(accumulated < 0 ? 'in' : 'out')
    accumulated = 0
  }
}
