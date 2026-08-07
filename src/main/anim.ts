/**
 * The open and close animation, driven from main because it moves the real
 * window rectangle.
 *
 * A CSS transform alone cannot do this. The window is `transparent: false` so
 * that DWM will paint an acrylic backdrop behind it, which means the window is
 * an opaque rectangle whatever the DOM inside it is doing — scale the content
 * and you are left looking at a frosted slab with a shrinking panel floating in
 * the middle of it. The rectangle itself has to move.
 *
 * So this steps `setBounds` while the renderer scales `#root` by the same
 * factor (see `renderer/src/motion.ts`). Two clocks, deliberately detuned: the
 * renderer's transition is slower on the way out and faster on the way in, so
 * the content is always a little *larger* than the window that clips it. Skew
 * in that direction is invisible; skew the other way opens a gap of desktop at
 * the edge.
 *
 * Everything here is in screen pixels, not DIP. `setBounds` and `getBounds`
 * agree with each other, which is all this needs.
 */

import type { BrowserWindow, Rectangle } from 'electron'
import { MOTION, WINDOW, type MotionMode } from '../shared/ipc'

/**
 * Three inputs, derived rather than stored as one flag.
 *
 * They arrive from three different places at three different times, and
 * collapsing them into a single boolean lets the last writer undo the others —
 * which is exactly what happened once already: the renderer reports "no
 * reduced-motion preference" shortly after launch, which cheerfully switched
 * the animation back on underneath the smoke suite that had just switched it
 * off, leaving main animating a window whose renderer was not.
 */
let permitted = true
let osReduce = false
let userReduce = false
let busy = false

/** Off for good. The smoke suite asserts window state, not easing curves. */
export function disable(): void {
  permitted = false
}

/** The OS preference, which only the renderer can read. May change at runtime. */
export function setReducedMotion(reduce: boolean): void {
  osReduce = reduce
}

/** The user's own toggle, which is deliberately separate from the OS one. */
export function setUserReducedMotion(reduce: boolean): void {
  userReduce = reduce
}

export function mode(): MotionMode {
  if (!permitted) return 'none'
  return osReduce || userReduce ? 'fade' : 'scale'
}

/**
 * True while a rectangle is mid-flight.
 *
 * Read by every caller that must not act on a window in an intermediate state:
 * `toggle` (so a mashed hotkey cannot interleave two animations), the blur
 * handler (so `hideOnBlur` cannot re-enter), and the bounds-persistence
 * debounce (so a shrunken rectangle is never written to settings).
 */
export function isBusy(): boolean {
  return busy
}

/**
 * A scaled-down rectangle, anchored at the target's bottom-right corner.
 *
 * Anchoring there is what makes it read as being pulled toward the tray rather
 * than folding up into its own title bar. Rounded, because a fractional
 * rectangle gets rounded by the compositor anyway and doing it here keeps the
 * corner pinned exactly.
 */
export function collapsedRect(target: Rectangle, scale: number): Rectangle {
  const width = Math.round(target.width * scale)
  const height = Math.round(target.height * scale)
  return {
    width,
    height,
    x: target.x + (target.width - width),
    y: target.y + (target.height - height),
  }
}

/** Where an open starts from. `show()` sets this before the window appears. */
export function enterRect(target: Rectangle): Rectangle {
  return collapsedRect(target, MOTION.enter)
}

/**
 * The two curves, and why they have to be these two.
 *
 * The renderer scales its content with a CSS transition, and a transition is
 * not a rectangle walk — they are two independent clocks running two
 * independent easings, and the only thing keeping them visually welded is that
 * both describe the same curve over the same distance. Point them in opposite
 * directions and the window races ahead of the content, which does not look
 * like a slow scale. It looks like the panel being cropped.
 *
 * These are standard shapes so `styles.css` can name the same two:
 * `cubic-bezier(0.33, 1, 0.68, 1)` for the open, `cubic-bezier(0.65, 0, 0.35, 1)`
 * for the close. The margin that keeps content larger than its window is
 * `MOTION.slack`, not a duration difference — a duration difference grows with
 * velocity, and it was cropping the rail off the left edge at speed.
 */
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

/**
 * Smoothstep — the classic 3t² − 2t³.
 *
 * Chosen for its peak velocity, which is 1.5× the average where an ease-in
 * cubic is 3×. On a stepped animation the peak velocity *is* the largest
 * visible jump, so halving it halves the jaggedness.
 */
export function smoothstep(t: number): number {
  return t * t * (3 - 2 * t)
}

/**
 * Interpolate between two rectangles that share a bottom-right corner.
 *
 * Both of them do, by construction — `collapsedRect` builds every intermediate
 * around that corner. So the corner is held fixed and the origin derived from
 * the size, rather than interpolating all four numbers and hoping they agree.
 *
 * Rounding four values independently does not keep `x + width` constant. It
 * drifts by a pixel, frame to frame, in whichever direction the two roundings
 * happen to disagree — so the edge that is supposed to be nailed down shimmers
 * for the whole animation.
 */
function lerpAnchored(from: Rectangle, to: Rectangle, t: number): Rectangle {
  const right = from.x + from.width
  const bottom = from.y + from.height
  const width = Math.round(from.width + (to.width - from.width) * t)
  const height = Math.round(from.height + (to.height - from.height) * t)
  return { width, height, x: right - width, y: bottom - height }
}

/**
 * Walk the window from one rectangle to another.
 *
 * A timer rather than the renderer's animation frames: this is the main
 * process, and the thing being animated is an OS window, not a layer the
 * compositor owns. The last step lands on `to` exactly rather than on whatever
 * the easing rounds to, because "almost the saved bounds" accumulates.
 */
/** One leg of an animation: where the rectangle goes, and how opaque it is. */
interface Leg {
  /** All three omitted by the fade mode, which never touches geometry. */
  from?: Rectangle
  to?: Rectangle
  ease?: (t: number) => number
  /** Window opacity endpoints. Always linear between them — see `run`. */
  fromOpacity: number
  toOpacity: number
  duration: number
}

/**
 * Walk the window through one leg.
 *
 * A timer rather than the renderer's animation frames: this is the main
 * process, and the thing being animated is an OS window, not a layer the
 * compositor owns. The last step lands on the endpoints exactly rather than on
 * whatever the easing rounds to, because "almost the saved bounds" accumulates.
 */
function run(win: BrowserWindow, leg: Leg): Promise<void> {
  // Not "jump to the destination" — do nothing at all. The destination of a
  // collapse is a rectangle nobody is meant to see, and `show()` skips the
  // collapsed start when this is off, so both legs are already where they
  // belong. Snapping to it here would leave the window shrunk behind a
  // `hide()`, which is exactly the state this is trying not to persist.
  if (mode() === 'none') {
    win.setOpacity(1)
    return Promise.resolve()
  }

  const { from, to, fromOpacity, toOpacity, duration, ease } = leg

  return new Promise((resolve) => {
    busy = true
    // The window has a minimum size, and it is larger than anything this
    // animation wants to pass through. Left in place it clamps the whole
    // collapse flat.
    if (from && to) win.setMinimumSize(1, 1)
    win.setOpacity(fromOpacity)

    const started = Date.now()
    const step = (): void => {
      if (win.isDestroyed()) return finish()

      // Elapsed time, not a frame counter: the interval is a request, not a
      // promise, and a missed tick should shorten the animation rather than
      // stretch it.
      const t = Math.min(1, (Date.now() - started) / duration)
      if (from && to) {
        win.setBounds(t >= 1 ? to : lerpAnchored(from, to, ease ? ease(t) : t))
      }
      // Opacity is linear against eased geometry on purpose: an eased fade on
      // top of an eased shrink compounds into a disappearance that happens all
      // at once somewhere in the middle.
      win.setOpacity(fromOpacity + (toOpacity - fromOpacity) * t)

      if (t >= 1) finish()
      else timer = setTimeout(step, MOTION.frame)
    }

    const finish = (): void => {
      if (timer) clearTimeout(timer)
      busy = false
      if (!win.isDestroyed()) win.setMinimumSize(WINDOW.minWidth, WINDOW.minHeight)
      resolve()
    }

    let timer: NodeJS.Timeout | null = setTimeout(step, MOTION.frame)
  })
}

/**
 * Leave. The caller hides the window the moment this resolves.
 *
 * The opacity ramp is the part that makes a close bearable. Geometry alone
 * cannot finish the job — the window has to stop existing at some point, in one
 * frame — so it reaches zero opacity exactly as it reaches its smallest size,
 * and the `hide()` that follows is invisible because there was nothing left to
 * hide.
 */
export function collapse(win: BrowserWindow, target: Rectangle): Promise<void> {
  if (mode() === 'fade') {
    return run(win, { fromOpacity: 1, toOpacity: 0, duration: MOTION.fadeDuration })
  }
  return run(win, {
    from: target,
    to: collapsedRect(target, MOTION.exit),
    fromOpacity: 1,
    toOpacity: 0,
    duration: MOTION.exitDuration,
    ease: smoothstep,
  })
}

/** Arrive. The window must already be visible, small and transparent. */
export function expand(win: BrowserWindow, target: Rectangle): Promise<void> {
  if (mode() === 'fade') {
    return run(win, { fromOpacity: 0, toOpacity: 1, duration: MOTION.fadeDuration })
  }
  return run(win, {
    from: enterRect(target),
    to: target,
    fromOpacity: 0,
    toOpacity: 1,
    duration: MOTION.enterDuration,
    ease: easeOutCubic,
  })
}

/**
 * Put the window back to fully opaque and full size.
 *
 * Belt and braces for the paths that bypass an animation — a destroyed-window
 * bail-out, or the mode changing mid-flight — because a window left at zero
 * opacity is indistinguishable from one that failed to open.
 */
export function reset(win: BrowserWindow): void {
  if (!win.isDestroyed()) win.setOpacity(1)
}
