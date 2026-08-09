/**
 * The installer's artwork, generated rather than hand-drawn.
 *
 * NSIS wants Windows bitmaps at two fixed sizes — 164x314 for the panel down
 * the side of the welcome and finish pages, 150x57 for the badge in the header
 * of every page in between — and it wants them as BMP, which nothing in this
 * project speaks. So they are composed here from `images/rune-panel-logo.png`
 * and written out directly.
 *
 * Generated, and committed, on purpose. The BMPs are what the build consumes,
 * so they have to be in the repository; a generator beside them is what stops
 * them becoming two files nobody can regenerate once the logo changes.
 *
 * Run with Electron rather than Node, for `nativeImage`: it is the only PNG
 * decoder this project already depends on, and adding an image library to draw
 * two pictures at build time would be a poor trade.
 *
 *   npx electron scripts/installer-art.mjs
 *
 * 24-bit BMP specifically. NSIS's support for the 32-bit form is patchy across
 * versions and the alpha channel would be ignored anyway, so the logo is
 * composited onto an opaque background here instead.
 */

import { app, nativeImage } from 'electron'
import { writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The mocha palette, which is what the app opens in.
 *
 * Kept as plain numbers rather than imported from the renderer's stylesheet:
 * this runs before anything is built, and the two are allowed to drift — the
 * installer is a first impression, not a themed surface.
 */
const SURFACE = [0x2b, 0x21, 0x1a]
const SUNKEN = [0x1c, 0x15, 0x10]
const GOLD = [0xd0, 0xa8, 0x6a]

/** A canvas of RGB pixels, top-down, with the drawing this needs and no more. */
function canvas(width, height, fill) {
  const px = Buffer.alloc(width * height * 3)
  for (let i = 0; i < width * height; i++) {
    px[i * 3] = fill[0]
    px[i * 3 + 1] = fill[1]
    px[i * 3 + 2] = fill[2]
  }
  return { width, height, px }
}

/**
 * A vertical wash from one colour to another.
 *
 * The first version of the panel put a hard edge between two flats, which read
 * as a mistake rather than a decision — the eye wants to know what the line
 * means and there is no answer. A gradient carries the same weight without
 * claiming to be a boundary.
 */
function gradient(c, top, bottom) {
  for (let row = 0; row < c.height; row++) {
    const t = row / (c.height - 1)
    for (let col = 0; col < c.width; col++) {
      const i = (row * c.width + col) * 3
      for (let ch = 0; ch < 3; ch++) {
        c.px[i + ch] = Math.round(top[ch] + (bottom[ch] - top[ch]) * t)
      }
    }
  }
}

function rect(c, x, y, w, h, colour) {
  for (let row = Math.max(0, y); row < Math.min(c.height, y + h); row++) {
    for (let col = Math.max(0, x); col < Math.min(c.width, x + w); col++) {
      const i = (row * c.width + col) * 3
      c.px[i] = colour[0]
      c.px[i + 1] = colour[1]
      c.px[i + 2] = colour[2]
    }
  }
}

/**
 * Draw a PNG onto the canvas, over whatever is already there.
 *
 * `toBitmap` hands back BGRA, and the alpha is real — the logo is a shape on
 * transparency, so it is blended rather than pasted or the pixel art would
 * arrive in a box of its own colour.
 */
function drawImage(c, image, x, y) {
  const { width, height } = image.getSize()
  const src = image.toBitmap()
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const s = (row * width + col) * 4
      const alpha = src[s + 3] / 255
      if (alpha === 0) continue

      const dx = x + col
      const dy = y + row
      if (dx < 0 || dy < 0 || dx >= c.width || dy >= c.height) continue

      const d = (dy * c.width + dx) * 3
      // BGRA in, RGB out.
      c.px[d] = Math.round(src[s + 2] * alpha + c.px[d] * (1 - alpha))
      c.px[d + 1] = Math.round(src[s + 1] * alpha + c.px[d + 1] * (1 - alpha))
      c.px[d + 2] = Math.round(src[s] * alpha + c.px[d + 2] * (1 - alpha))
    }
  }
}

/** 24-bit BMP: rows bottom-up, each padded to a four-byte boundary. */
function encodeBmp(c) {
  const stride = Math.ceil((c.width * 3) / 4) * 4
  const pixels = Buffer.alloc(stride * c.height)

  for (let row = 0; row < c.height; row++) {
    const flipped = c.height - 1 - row
    for (let col = 0; col < c.width; col++) {
      const s = (row * c.width + col) * 3
      const d = flipped * stride + col * 3
      // BMP stores blue first.
      pixels[d] = c.px[s + 2]
      pixels[d + 1] = c.px[s + 1]
      pixels[d + 2] = c.px[s]
    }
  }

  const header = Buffer.alloc(54)
  header.write('BM', 0)
  header.writeUInt32LE(54 + pixels.length, 2)
  header.writeUInt32LE(54, 10)
  header.writeUInt32LE(40, 14)
  header.writeInt32LE(c.width, 18)
  header.writeInt32LE(c.height, 22)
  header.writeUInt16LE(1, 26)
  header.writeUInt16LE(24, 28)
  header.writeUInt32LE(pixels.length, 34)
  return Buffer.concat([header, pixels])
}

/** Scale to fit a box, keeping the pixel art crisp rather than smoothed. */
function fit(image, maxWidth, maxHeight) {
  const { width, height } = image.getSize()
  const scale = Math.min(maxWidth / width, maxHeight / height)
  return image.resize({
    width: Math.round(width * scale),
    height: Math.round(height * scale),
    quality: 'best',
  })
}

function build() {
  const logo = nativeImage.createFromPath(join(root, 'images/rune-panel-logo.png'))
  if (logo.isEmpty()) throw new Error('images/rune-panel-logo.png did not decode')

  mkdirSync(join(root, 'build'), { recursive: true })

  /* ── The side panel, 164x314 ──────────────────────────────────────────
     Wizard pages put their own title and body to the right of this, so it is
     a panel rather than a page: the mark on a wash that deepens towards the
     floor, and a gold seam down the edge the wizard's own pages butt against. */
  const side = canvas(164, 314, SURFACE)
  gradient(side, SURFACE, SUNKEN)

  const sideLogo = fit(logo, 128, 128)
  drawImage(
    side,
    sideLogo,
    Math.round((164 - sideLogo.getSize().width) / 2),
    // Above centre rather than on it: the wizard's own heading sits high on
    // the page beside this, and a mark level with it reads as one composition.
    Math.round(314 * 0.3 - sideLogo.getSize().height / 2)
  )
  rect(side, 162, 0, 2, 314, GOLD)
  writeFileSync(join(root, 'build/installerSidebar.bmp'), encodeBmp(side))

  /* ── The header badge, 150x57 ─────────────────────────────────────────
     Sits in the corner of every interior page. Small, so the banner in the
     logo is unreadable at this size and the mark alone is the point. */
  const head = canvas(150, 57, SURFACE)
  rect(head, 0, 55, 150, 2, GOLD)
  const headLogo = fit(logo, 96, 45)
  drawImage(
    head,
    headLogo,
    Math.round((150 - headLogo.getSize().width) / 2),
    Math.round((55 - headLogo.getSize().height) / 2)
  )
  writeFileSync(join(root, 'build/installerHeader.bmp'), encodeBmp(head))

  console.log('wrote build/installerSidebar.bmp (164x314) and build/installerHeader.bmp (150x57)')
}

app.whenReady().then(() => {
  try {
    build()
    app.exit(0)
  } catch (err) {
    console.error(err)
    app.exit(1)
  }
})
