/**
 * The renderer's half of the open and close animation.
 *
 * Main walks the window rectangle (see `main/anim.ts`); this scales `#root` by
 * the same factor so the content tracks the frame instead of reflowing inside
 * it ten times on the way down.
 *
 * Deliberately outside React. The element being animated is `#root` itself,
 * which is above every component and always present — `App` renders three
 * different top-level branches (loading, setup wizard, shell) and threading a
 * class through all of them to animate the window would be the tail wagging the
 * dog. Nothing here needs a render.
 *
 * ## Freezing
 *
 * `#root` inherits `height: 100%`, so shrinking the window would resize it and
 * rewrap every line of article text. Before collapsing, its full-size box is
 * written on as inline pixels; the transform then scales that fixed box and the
 * window clips it. Cleared once the window is back at full size.
 *
 * The window is frameless, so its bounds and its content box are the same
 * rectangle in DIP — which is why main can send the size and this can trust it.
 *
 * ## The invariant
 *
 * **While the window is hidden, `#root` stays collapsed.** That is what makes
 * opening free of a flash: main sets the small rectangle and shows, and the
 * content is already the right size for it. It also means this module starts
 * collapsed on load, with a fallback below in case the first open never lands.
 */

import { MOTION } from '../../shared/ipc'

const root = document.getElementById('root')

/**
 * How long to wait for the first `open` before assuming it is not coming.
 *
 * Starting collapsed is what removes the flash, but it means a dropped event
 * would leave the UI stuck at 85% with no way back. Generous, because it only
 * ever fires when something has already gone wrong.
 */
const FIRST_OPEN_TIMEOUT = 1000

/** Apply a style change with no transition, and leave transitions back on. */
function instantly(el: HTMLElement, change: () => void): void {
  el.classList.add('is-instant')
  change()
  void el.offsetWidth
  el.classList.remove('is-instant')
  void el.offsetWidth
}

/**
 * Where the collapsed state currently sits. Read by the stylesheet.
 *
 * `slack` keeps the content fractionally larger than the window that clips it,
 * so a frame of drift between the compositor's transition and main's timer can
 * only ever crop content — never expose a strip of desktop along the edge.
 */
function setScale(el: HTMLElement, scale: number): void {
  el.style.setProperty('--rp-collapsed', String(scale * MOTION.slack))
}

/**
 * Timer for parking at the enter scale after a close, cancelled if you reopen
 * before it fires.
 */
let park: number | undefined

function collapse(el: HTMLElement, width: number, height: number): void {
  window.clearTimeout(park)
  el.style.width = `${width}px`
  el.style.height = `${height}px`
  setScale(el, MOTION.exit)
  // Flush the frozen size and the target scale before the class lands. Without
  // this the browser coalesces everything into one style change and there is
  // nothing to animate from.
  void el.offsetWidth
  el.classList.add('is-collapsed')

  // The close ends far smaller than the next open begins, so once the window is
  // gone, park at the scale an open starts from. Doing it here rather than at
  // the start of the open is what keeps the first frame of an open from showing
  // a 28% panel inside an 85% window.
  park = window.setTimeout(() => {
    if (el.classList.contains('is-collapsed')) instantly(el, () => setScale(el, MOTION.enter))
  }, MOTION.exitDuration + 80)
}

function expand(el: HTMLElement): void {
  window.clearTimeout(park)
  // Reopening mid-close gets here before the park timer did, so make sure the
  // growth starts from the enter scale either way.
  instantly(el, () => setScale(el, MOTION.enter))
  el.classList.remove('is-collapsed')
  // Hand the size back to the stylesheet only once the window has finished
  // growing. Any earlier and the layout snaps to an intermediate window size.
  window.setTimeout(() => {
    if (el.classList.contains('is-collapsed')) return
    el.style.width = ''
    el.style.height = ''
  }, MOTION.enterDuration + 50)
}

export function install(): void {
  if (!root) return
  const el = root

  // Main cannot read a media query. Its half of the animation is switched off
  // from here; the CSS half is handled by the reduced-motion block in
  // styles.css.
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')
  window.rp.reportReduceMotion(reduce.matches)
  reduce.addEventListener('change', (e) => window.rp.reportReduceMotion(e.matches))

  let opened = false
  window.rp.onMotion((event) => {
    opened = true
    // Only `scale` involves the renderer. `fade` is window opacity, which main
    // applies to the whole window including this content, and `none` is the
    // smoke suite. In either case the transform must not be left applied: it is
    // not merely a wasted animation, it is a lie about the layout —
    // `getBoundingClientRect` reports scaled, shifted coordinates, which is how
    // the embedded pane learns where to sit.
    if (event.mode !== 'scale') return release(el)
    if (event.phase === 'close') collapse(el, event.width, event.height)
    else expand(el)
  })

  // The launch mode, plus the one thing main does not know yet: the OS
  // preference, which arrives at main a moment after this runs. Checking it
  // here too keeps the very first frame from collapsing when it should not.
  if (window.rp.motionMode !== 'scale' || reduce.matches) return

  // Start collapsed and stay there until the window is actually shown — at the
  // scale an open begins from, and with no transition, because this is the
  // initial state rather than a change.
  el.style.width = `${el.clientWidth}px`
  el.style.height = `${el.clientHeight}px`
  instantly(el, () => {
    setScale(el, MOTION.enter)
    el.classList.add('is-collapsed')
  })
  window.setTimeout(() => {
    if (!opened) expand(el)
  }, FIRST_OPEN_TIMEOUT)
}

/** Drop every trace of the scale animation, for the modes that do not use it. */
function release(el: HTMLElement): void {
  window.clearTimeout(park)
  instantly(el, () => {
    el.classList.remove('is-collapsed')
    el.style.width = ''
    el.style.height = ''
  })
}
