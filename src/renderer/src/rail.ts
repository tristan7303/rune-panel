/**
 * Dragging the navigation rail into your own order.
 *
 * The shape of this follows what the established list-reordering libraries
 * settled on — dnd-kit, react-beautiful-dnd, SortableJS all behave the same way
 * once you strip the API differences — because the alternatives were tried here
 * first and each one is worse in a way you can feel:
 *
 *  1. **The carried item follows the pointer exactly**, as a transform. Not a
 *     copy, not a ghost: the element itself, lifted. Anything that moves in
 *     steps reads as the list resisting you.
 *
 *  2. **The DOM order never changes while dragging.** The others slide aside by
 *     exactly one slot, as transforms, and the list only really reorders on
 *     drop. This was the first version's mistake — it reordered live, which
 *     made the layout jump under the cursor, and (measured) dropped the pointer
 *     capture every time React moved the dragged node, freezing the drag.
 *
 *  3. **Places swap when centres cross**, not when the pointer enters some
 *     zone. Comparing the carried item's own centre against its neighbours'
 *     resting centres gives the hysteresis for free: an entry that has moved
 *     aside stays aside until you genuinely come back past it, so nothing
 *     flickers at the boundary.
 *
 *  4. **The drop is animated, not snapped.** Releasing eases the item from
 *     wherever the pointer left it to where it is about to sit, and only then
 *     is the new order committed — so the moment the real reorder happens, the
 *     element is already exactly where the reorder will put it, and nothing
 *     visibly moves.
 */

import { useCallback, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { RailId } from '@shared/ipc'

/**
 * How far the pointer must travel before the entry lifts.
 *
 * Eight, which is what dnd-kit uses for the same job, rather than the four or
 * five a mouse driver would call a drag: this only decides when to start
 * *showing* a drag, and an icon that jumps out of the rail because a click
 * wobbled reads as the rail being twitchy.
 */
const DRAG_THRESHOLD_PX = 8

/** How long an entry takes to slide out of the way, and to land on release. */
const SLIDE_MS = 180

/** The easing everything here shares: quick to leave, settled on arrival. */
const EASE = 'cubic-bezier(0.2, 0, 0, 1)'

interface DragState {
  id: RailId
  /** Index it was picked up from, in the committed order. */
  from: number
  /** Where it would land if released now. */
  to: number
  /** How far the pointer has carried it, in pixels. */
  dy: number
  /** True once released, while it eases into its resting place. */
  settling: boolean
}

export interface RailDragApi {
  /** The entry being carried, if any. */
  dragging: RailId | null
  /** Inline style for the entry at this index in the committed order. */
  styleFor: (index: number) => CSSProperties | undefined
  /** Attach to each entry's `onPointerDown`. */
  start: (e: React.PointerEvent<HTMLElement>, id: RailId, from: number) => void
  /**
   * True when the last press turned into a drag, so the click that follows can
   * be swallowed — otherwise letting go of an entry also navigates to it.
   */
  consumeClick: () => boolean
}

/** Reorder by id, moving one entry to an index. */
export function reorder(ids: RailId[], id: RailId, to: number): RailId[] {
  const from = ids.indexOf(id)
  if (from < 0) return ids
  const out = [...ids]
  out.splice(from, 1)
  out.splice(Math.max(0, Math.min(to, out.length)), 0, id)
  return out
}

export function useRailDrag(order: RailId[], onCommit: (next: RailId[]) => void): RailDragApi {
  const [drag, setDragState] = useState<DragState | null>(null)

  /**
   * The same value, readable synchronously from a pointer handler.
   *
   * `pointerup` has to know where the entry ended up in order to decide what to
   * commit, and state read from the closure there is whatever it was when the
   * handler was created. Reading a ref keeps that decision out of a state
   * updater, which React is free to run more than once — and does, under the
   * StrictMode this app renders in.
   */
  const dragRef = useRef<DragState | null>(null)
  const setDrag = useCallback((next: DragState | null) => {
    dragRef.current = next
    setDragState(next)
  }, [])

  /** Where every entry sat when the press began, and how tall a slot is. */
  const geometry = useRef<{ centres: number[]; slot: number }>({ centres: [], slot: 0 })

  /** Whether this press has passed the threshold and is showing as a drag. */
  const lifted = useRef(false)

  /**
   * Whether the click that follows should be swallowed.
   *
   * Set on release, from whether the entry actually changed places — not from
   * whether the press wobbled. Those were the same flag once, and the cost was
   * exact: a click that drifted as little as five pixels was treated as a drag,
   * so it was swallowed; five pixels is nowhere near the half-slot needed to
   * move anything, so nothing was reordered either. The result was a rail where
   * a slightly sloppy click did *nothing at all*, silently, and clicking again
   * usually drifted too — which is what being stuck on a page feels like.
   *
   * A drag that put the entry back where it started is, as far as anyone can
   * tell, a click.
   */
  const suppressClick = useRef(false)

  const start = useCallback(
    (e: React.PointerEvent<HTMLElement>, id: RailId, from: number) => {
      if (e.button !== 0) return
      const rail = e.currentTarget.parentElement
      if (!rail) return

      // Measured once. The list does not move during the drag, so these stay
      // true for its whole duration — which is the point of not reordering.
      const boxes = [...rail.querySelectorAll<HTMLElement>('[data-rail-id]')].map((el) =>
        el.getBoundingClientRect()
      )
      geometry.current = {
        centres: boxes.map((b) => b.top + b.height / 2),
        // Centre to centre, so the gap between entries is included. Falls back
        // to the entry's own height when it is the only one there.
        slot: boxes.length > 1 ? boxes[1].top - boxes[0].top : (boxes[0]?.height ?? 0),
      }

      const startY = e.clientY
      lifted.current = false
      suppressClick.current = false

      const onMove = (move: PointerEvent): void => {
        const dy = move.clientY - startY
        if (!lifted.current) {
          if (Math.abs(dy) < DRAG_THRESHOLD_PX) return
          lifted.current = true
        }

        // Where the carried entry's own centre now is, and how many of its
        // neighbours it has passed. Comparing centre against centre is what
        // makes a swap stick: after one happens, coming back requires crossing
        // the same line from the other side.
        const centre = geometry.current.centres[from] + dy
        let to = from
        for (let i = 0; i < geometry.current.centres.length; i++) {
          if (i === from) continue
          if (i > from && geometry.current.centres[i] < centre) to++
          if (i < from && geometry.current.centres[i] > centre) to--
        }

        setDrag({ id, from, to, dy, settling: false })
      }

      const finish = (): void => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', finish)
        window.removeEventListener('pointercancel', finish)
        window.removeEventListener('blur', finish)

        // Read rather than mutated inside the updater below: React may invoke a
        // state updater more than once (it does under StrictMode), and anything
        // with a side effect in it would then run twice.
        const landed = dragRef.current
        suppressClick.current = landed !== null && landed.to !== landed.from

        if (landed) {
          // Ease it the rest of the way to where it will sit, then commit. By
          // the time the list really reorders, the element is already there.
          const resting = (landed.to - landed.from) * geometry.current.slot
          setDrag({ ...landed, dy: resting, settling: true })
          window.setTimeout(() => {
            if (landed.to !== landed.from) onCommit(reorder(order, landed.id, landed.to))
            setDrag(null)
          }, SLIDE_MS)
        }

        // The suppression expires with the press that earned it: a click
        // follows `pointerup` in the same task, so a timeout leaves it standing
        // for exactly that one click. Clearing it only when a click arrives
        // assumed every drag ends in one, and a drag ending over a different
        // entry fires none — the flag then survived to swallow a real click.
        window.setTimeout(() => {
          suppressClick.current = false
        }, 0)
      }

      /**
       * Watched on `window`, and the pointer is never captured.
       *
       * Capture looked like the right tool — it keeps events coming if the
       * cursor leaves the rail — but it retargets the `click` after the press
       * to whatever element holds the capture. That is fatal here, because
       * every entry is a link: a captured press could never navigate, however
       * small, so any click that wobbled past the threshold did nothing at all.
       *
       * Without it, the browser's own rule does exactly the right thing. A
       * click is dispatched to the common ancestor of where the press went down
       * and where it came up: wobble on one entry and both are that entry, so
       * it navigates; drag to another and the common ancestor is the rail, so
       * nothing is clicked. `window` rather than the rail because the pointer
       * spends most of a real drag outside it, and `blur` because a press
       * interrupted by the window losing focus never gets a `pointerup`.
       */
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', finish)
      window.addEventListener('pointercancel', finish)
      window.addEventListener('blur', finish)
    },
    [order, onCommit, setDrag]
  )

  /**
   * What each entry should be doing right now.
   *
   * The carried one is where the pointer put it and lifted; everything between
   * where it came from and where it is going has stepped one slot towards the
   * hole it left. Nothing else moves at all.
   */
  const styleFor = useCallback(
    (index: number): CSSProperties | undefined => {
      if (!drag) return undefined

      if (index === drag.from) {
        return {
          transform: `translate3d(0, ${drag.dy}px, 0) scale(1.08)`,
          zIndex: 2,
          // No transition while the pointer holds it: the element has to be
          // exactly where the cursor is, not easing towards it.
          transition: drag.settling ? `transform ${SLIDE_MS}ms ${EASE}` : 'none',
        }
      }

      const { from, to, slot } = { ...drag, slot: geometry.current.slot }
      let shift = 0
      if (to > from && index > from && index <= to) shift = -slot
      if (to < from && index < from && index >= to) shift = slot

      return {
        transform: `translate3d(0, ${shift}px, 0)`,
        transition: `transform ${SLIDE_MS}ms ${EASE}`,
      }
    },
    [drag]
  )

  return {
    dragging: drag?.id ?? null,
    styleFor,
    start,
    consumeClick: useCallback(() => suppressClick.current, []),
  }
}
