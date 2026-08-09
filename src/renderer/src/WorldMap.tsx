/**
 * The world map, expanded.
 *
 * The wiki's own expand button hands you a Leaflet widget its map script
 * builds, and that script is not here — but nothing about the map needs it. The
 * tiles are plain PNGs on a public server, cut the same way every slippy map
 * cuts them, so this is a small one: work out which tiles the viewport covers,
 * place them, and move the camera on drag.
 *
 * ## The tile scheme
 *
 * `{base}/{mapId}/{zoom}/{plane}_{tileX}_{tileY}.png`, and all three of those
 * numbers mean different things:
 *
 *  - **map id** is which world. The surface is 0; anywhere the surface cannot
 *    hold is given its own coordinate space, so Dorgesh-Kaan is 5, Keldagrim 10
 *    and Neypotzli 45. Reading the map id as the plane — they are both usually
 *    0, so the surface hides it — asks map 0 for coordinates that only exist on
 *    another map, and every tile comes back 404.
 *  - **zoom** runs -1 to 3 on every map. A tile is always 256px and covers
 *    `256 / 2^zoom` game squares, so zoom 1 draws two pixels to the square and
 *    zoom 3 draws eight.
 *  - **plane** is the storey, 0 to 3, and it is the *filename* that carries it.
 *    Upper floors are drawn only where a building has one, which is why the
 *    higher planes are mostly empty space with rooms floating in it.
 *
 * Tile indices are the game square divided by the span, with **north up**: row
 * `ty` covers the squares *above* `ty * span`, which is why every conversion
 * here flips the sign of y and none of them flip x.
 *
 * ## Fractional zoom
 *
 * The camera's zoom moves in halves, but the server only cuts tiles at whole
 * ones. So tiles are fetched at the nearest whole zoom and the layer holding
 * them is scaled the rest of the way. The scale is a transform on the layer
 * rather than a size on each tile deliberately: sizing 30 tiles to a fractional
 * pixel width leaves a seam wherever two of them meet, and scaling the
 * composited layer has no seams to leave.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react'
import type { InfoboxMap } from '@shared/ipc'
import { CloseIcon } from './icons'

/** Edge of a tile, in pixels. Fixed by the server's cutting. */
const TILE = 256

/** What the server carries, on every map. Zoom 4 is a 404; -2 is not offered. */
const MIN_ZOOM = -1
const MAX_ZOOM = 3

/** Half a zoom level a notch — a whole one jumps too far to follow. */
const ZOOM_STEP = 0.5

/** Storeys the tile scheme allows. */
const PLANES = [0, 1, 2, 3]

/**
 * Where an expand starts.
 *
 * Deeper than the infobox frame, which is the point of expanding: the card is
 * already showing zoom 1 or 2, and arriving at the same scale in a bigger
 * window would only show more of the surroundings rather than more of the place.
 */
const OPEN_ZOOM = 3

/** Screen pixels one game square occupies at a zoom. Fractional zooms included. */
const scaleAt = (zoom: number): number => 2 ** zoom

interface Camera {
  /** Game square held at the centre of the viewport. */
  x: number
  y: number
  /** May sit on a half step, which no tile is cut at. */
  zoom: number
}

export function WorldMap({
  map,
  title,
  onClose,
}: {
  map: InfoboxMap
  title: string
  onClose: () => void
}): JSX.Element {
  const [camera, setCamera] = useState<Camera>({
    x: map.x,
    y: map.y,
    zoom: Math.min(Math.max(map.zoom, OPEN_ZOOM), MAX_ZOOM),
  })
  const [plane, setPlane] = useState(map.plane)
  const [size, setSize] = useState({ width: 0, height: 0 })
  /** Tiles the server does not have, so they are not asked for twice. */
  const [missing, setMissing] = useState<ReadonlySet<string>>(() => new Set())
  const viewRef = useRef<HTMLDivElement>(null)

  // Measured rather than assumed: the window is resizable and the overlay fills
  // it, so the tile grid has to be computed against what the box actually became.
  useLayoutEffect(() => {
    const el = viewRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize({ width, height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  /**
   * Escape closes the map, and only the map.
   *
   * On the capture phase, and it stops the event dead. The app already has a
   * window-level Escape that unwinds one layer — out of a subview, then out of
   * the app entirely — and a bubble-phase listener here would run *after* it,
   * so a single press both closed the map and navigated away from the article
   * underneath it. The overlay is a layer too, and the innermost one, so it is
   * the one that has to answer.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  /**
   * Zoom about a point, keeping the game square under it where it is.
   *
   * Without the correction a wheel over the corner of the map walks the thing
   * you were pointing at off the screen, which is the difference between a map
   * you can read and one you have to chase.
   */
  const zoomAbout = useCallback((delta: number, clientX?: number, clientY?: number) => {
    setCamera((cam) => {
      const next = Math.min(Math.max(cam.zoom + delta, MIN_ZOOM), MAX_ZOOM)
      if (next === cam.zoom) return cam

      const el = viewRef.current
      if (!el || clientX === undefined || clientY === undefined) return { ...cam, zoom: next }

      const box = el.getBoundingClientRect()
      const offX = clientX - box.left - box.width / 2
      const offY = clientY - box.top - box.height / 2
      // The square under the cursor now, and where the same offset would land
      // after the scale change; the camera moves by the difference.
      const before = scaleAt(cam.zoom)
      const after = scaleAt(next)
      return {
        zoom: next,
        x: cam.x + offX / before - offX / after,
        y: cam.y - offY / before + offY / after,
      }
    })
  }, [])

  useEffect(() => {
    const el = viewRef.current
    if (!el) return
    // Registered by hand rather than through React's onWheel, because that one
    // is passive and cannot call preventDefault — and without that the article
    // underneath scrolls while you are zooming the map on top of it.
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      zoomAbout(e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP, e.clientX, e.clientY)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomAbout])

  /** Drag to pan. Pointer capture so a fast drag off the edge still tracks. */
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const start = { x: e.clientX, y: e.clientY, cam: camera }

    const onMove = (move: PointerEvent): void => {
      const scale = scaleAt(start.cam.zoom)
      setCamera({
        ...start.cam,
        // Dragging right pulls the map right, which means looking further west.
        x: start.cam.x - (move.clientX - start.x) / scale,
        y: start.cam.y + (move.clientY - start.y) / scale,
      })
    }
    const onUp = (): void => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
  }

  // The whole zoom the tiles come from, and how far the layer is scaled to make
  // up the difference. Nearest rather than lower: it halves the worst-case
  // stretch, so a half step is 1.41x up at most instead of 2x.
  const tileZoom = Math.min(Math.max(Math.round(camera.zoom), MIN_ZOOM), MAX_ZOOM)
  const stretch = scaleAt(camera.zoom - tileZoom)

  // Everything below is in *tile space* — pixels at `tileZoom`, before the
  // stretch — so that tiles land on whole 256px boundaries and never seam.
  const tileScale = scaleAt(tileZoom)
  const camX = camera.x * tileScale
  const camY = -camera.y * tileScale
  const viewW = size.width / stretch
  const viewH = size.height / stretch
  const left = camX - viewW / 2
  const top = camY - viewH / 2

  const candidates: Array<{ src: string; left: number; top: number }> = []
  if (size.width > 0) {
    const firstX = Math.floor(left / TILE)
    const lastX = Math.floor((left + viewW) / TILE)
    // Tile row `ty` spans tile-space y from -(ty+1)*TILE to -ty*TILE, so the top
    // edge of the viewport is the highest row and the bottom edge the lowest.
    const lastY = Math.ceil(-top / TILE) - 1
    const firstY = Math.ceil(-(top + viewH) / TILE) - 1

    for (let ty = firstY; ty <= lastY; ty++) {
      for (let tx = firstX; tx <= lastX; tx++) {
        candidates.push({
          src: `${map.tileBase}/${map.mapId}/${tileZoom}/${plane}_${tx}_${ty}.png`,
          left: tx * TILE,
          top: -(ty + 1) * TILE,
        })
      }
    }
  }
  const tiles = candidates.filter((tile) => !missing.has(tile.src))

  /**
   * A tile is drawn one screen pixel larger than it is, so it laps its
   * neighbour.
   *
   * The camera sits on a fractional square and the zoom on a fractional scale,
   * so a tile's edges almost never land on a whole device pixel. Two tiles that
   * abut at 340.3px each get their edge antialiased against the layer behind,
   * and the result is a faint grid ruled across the whole map — visible on any
   * dense area, and exactly the sort of thing that says "assembled from tiles"
   * rather than "a map". The lap is content the neighbour is drawing anyway, so
   * covering it costs nothing; expressed in tile space, one screen pixel is
   * `1 / stretch`.
   */
  const bleed = TILE + 1 / stretch

  const markMissing = (src: string): void =>
    setMissing((seen) => {
      if (seen.has(src)) return seen
      const next = new Set(seen)
      next.add(src)
      return next
    })

  return (
    <div className="worldmap" role="dialog" aria-modal="true" aria-label={`Map of ${title}`}>
      <div className="worldmap-bar">
        <h2>{title}</h2>
        <span className="worldmap-coords">
          {Math.round(camera.x)}, {Math.round(camera.y)}
        </span>

        {/* Storeys. Always offered rather than probed for, because whether a
            floor exists is a question only the tiles can answer and asking
            costs a request per floor per place. An empty one says so below. */}
        <div className="worldmap-planes" role="group" aria-label="Floor">
          <span className="worldmap-planes-label">Floor</span>
          {PLANES.map((p) => (
            <button
              key={p}
              className={`btn worldmap-plane ${p === plane ? 'is-active' : ''}`}
              aria-pressed={p === plane}
              onClick={() => setPlane(p)}
            >
              {p}
            </button>
          ))}
        </div>

        <div className="worldmap-zoom">
          <button
            className="btn"
            onClick={() => zoomAbout(-ZOOM_STEP)}
            disabled={camera.zoom <= MIN_ZOOM}
            aria-label="Zoom out"
          >
            −
          </button>
          <button
            className="btn"
            onClick={() => zoomAbout(ZOOM_STEP)}
            disabled={camera.zoom >= MAX_ZOOM}
            aria-label="Zoom in"
          >
            +
          </button>
          <button
            className="btn"
            onClick={() => {
              setCamera({ x: map.x, y: map.y, zoom: OPEN_ZOOM })
              setPlane(map.plane)
            }}
          >
            Re-Center
          </button>
        </div>

        <button className="btn worldmap-close" onClick={onClose} aria-label="Close map">
          <CloseIcon />
        </button>
      </div>

      <div className="worldmap-view" ref={viewRef} onPointerDown={onPointerDown}>
        <div
          className="worldmap-tiles"
          style={{
            transform: `translate(${-left * stretch}px, ${-top * stretch}px) scale(${stretch})`,
            // Upscaling pixel art wants hard edges; downscaling it wants the
            // browser's filter, or the map crawls with aliasing as it moves.
            imageRendering: stretch >= 1 ? 'pixelated' : 'auto',
          }}
        >
          {tiles.map((tile) => (
            <img
              key={tile.src}
              src={tile.src}
              alt=""
              width={TILE}
              height={TILE}
              draggable={false}
              style={{ left: tile.left, top: tile.top, width: bleed, height: bleed }}
              // Off the edge of the surveyed world, and on any floor a building
              // does not reach, the server answers 404. Dropping those rather
              // than letting them draw is what keeps the sea empty instead of
              // tiled with broken-image glyphs.
              onError={() => markMissing(tile.src)}
            />
          ))}

          {/* Where the article's subject is. It earns its place once you have
              panned off it: the map gives no other way back. */}
          {size.width > 0 && (
            <Pin left={map.x * tileScale} top={-map.y * tileScale} label={title} scale={stretch} />
          )}
        </div>

        {candidates.length > 0 && tiles.length === 0 && (
          <p className="worldmap-empty">
            Nothing is mapped on floor {plane} here.
            {plane !== map.plane && (
              <>
                {' '}
                <button className="link-btn" onClick={() => setPlane(map.plane)}>
                  Back to floor {map.plane}
                </button>
              </>
            )}
          </p>
        )}
      </div>

      <p className="worldmap-hint">Drag to pan · scroll to zoom · Esc to close</p>
    </div>
  )
}

/**
 * The subject's own square, marked.
 *
 * Inside the scaled layer so it travels with the tiles, which means undoing
 * that scale on itself — a pin that grew with the map would be a saucer at zoom
 * 3 and invisible at -1.
 */
function Pin({
  left,
  top,
  label,
  scale,
}: {
  left: number
  top: number
  label: string
  scale: number
}): JSX.Element {
  return (
    <span
      className="worldmap-pin"
      style={{ left, top, transform: `translate(-50%, -50%) scale(${1 / scale})` }}
      title={label}
    >
      <span className="worldmap-pin-dot" />
    </span>
  )
}
