/**
 * Generates the tray icon as a PNG, so the repo carries no opaque binary and
 * the palette stays editable in one place.
 *
 * Pure Node — a minimal PNG encoder (IHDR / IDAT / IEND with CRC32) over an
 * RGBA buffer. Draws an antialiased violet-to-cyan rounded square, the same
 * mark the rail shows, on the same accent ramp as the stylesheet.
 *
 *   node scripts/make-icon.js
 */

const zlib = require('zlib')
const fs = require('fs')
const path = require('path')

const SIZE = 32
const ACCENT_A = [0xb3, 0x9b, 0xff] // violet
const ACCENT_B = [0x6e, 0xc1, 0xff] // cyan

// ── PNG encoding ────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

function encodePng(rgba, width, height) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8   // bit depth
  ihdr[9] = 6   // colour type: RGBA
  ihdr[10] = 0  // deflate
  ihdr[11] = 0  // adaptive filtering
  ihdr[12] = 0  // no interlace

  // Each scanline is prefixed with its filter type; 0 = none.
  const raw = Buffer.alloc(height * (width * 4 + 1))
  for (let y = 0; y < height; y++) {
    const src = y * width * 4
    const dst = y * (width * 4 + 1)
    raw[dst] = 0
    rgba.copy(raw, dst + 1, src, src + width * 4)
  }

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ── the mark ────────────────────────────────────────────────────────────────

const lerp = (a, b, t) => a + (b - a) * t
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

/** Signed distance to a rounded rectangle; negative inside. */
function roundedBox(dx, dy, half, radius) {
  const qx = Math.abs(dx) - half + radius
  const qy = Math.abs(dy) - half + radius
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0))
  const inside = Math.min(Math.max(qx, qy), 0)
  return outside + inside - radius
}

function render() {
  const rgba = Buffer.alloc(SIZE * SIZE * 4)
  const c = (SIZE - 1) / 2
  const half = SIZE / 2 - 1.5
  const corner = half * 0.54 // matches the 7px-on-26px radius of the rail mark
  const edge = 1.2 // antialias width in px

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = x - c
      const dy = y - c

      // Smooth coverage across the rim instead of a hard cutoff.
      const coverage = clamp01(-roundedBox(dx, dy, half, corner) / edge)

      // Diagonal ramp, plus a lift toward the top-left so it catches light the
      // same way the CSS gradient does.
      const t = clamp01((dx + dy) / (2 * half) + 0.5)
      const lift = clamp01(0.55 - (dx * 0.5 + dy * 0.7) / (half * 2)) * 0.3

      const i = (y * SIZE + x) * 4
      rgba[i] = Math.round(clamp01(lerp(ACCENT_A[0], ACCENT_B[0], t) / 255 + lift) * 255)
      rgba[i + 1] = Math.round(clamp01(lerp(ACCENT_A[1], ACCENT_B[1], t) / 255 + lift) * 255)
      rgba[i + 2] = Math.round(clamp01(lerp(ACCENT_A[2], ACCENT_B[2], t) / 255 + lift) * 255)
      rgba[i + 3] = Math.round(coverage * 255)
    }
  }
  return rgba
}

const out = path.join(__dirname, '..', 'resources')
fs.mkdirSync(out, { recursive: true })

const file = path.join(out, 'tray.png')
fs.writeFileSync(file, encodePng(render(), SIZE, SIZE))
console.log(`wrote ${path.relative(process.cwd(), file)} (${SIZE}x${SIZE})`)
