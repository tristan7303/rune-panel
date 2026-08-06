/**
 * The app icon, in the sizes Windows asks for.
 *
 * One source file, resized at runtime rather than checked in at several sizes:
 * `nativeImage.resize` uses the same scaler either way, and one file cannot
 * drift out of step with the others.
 *
 * The artwork is 1024x952 — wider than it is tall. Window and tray icons are
 * square, so it is padded onto a transparent square first; scaling it directly
 * would squash the mark by 7%, which is small enough to look like bad
 * rendering rather than a deliberate shape.
 */

import { app, nativeImage, type NativeImage } from 'electron'
import { join } from 'path'

let squared: NativeImage | null = null

function iconPath(): string {
  // Packaged builds get resources/ copied next to the app; in dev it sits at
  // the project root, two levels up from out/main.
  return app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(__dirname, '../../resources/icon.png')
}

/** Full-size and square, for the window and taskbar. */
export function appIcon(): NativeImage {
  if (squared) return squared

  const source = nativeImage.createFromPath(iconPath())
  if (source.isEmpty()) return source

  const { width, height } = source.getSize()
  if (width === height) {
    squared = source
    return squared
  }

  // Centre the artwork on a transparent square. The bitmap is BGRA, four bytes
  // a pixel, and a zero-filled buffer is already fully transparent.
  const side = Math.max(width, height)
  const src = source.toBitmap()
  const dst = Buffer.alloc(side * side * 4)
  const offsetX = Math.floor((side - width) / 2)
  const offsetY = Math.floor((side - height) / 2)

  for (let y = 0; y < height; y++) {
    src.copy(dst, ((y + offsetY) * side + offsetX) * 4, y * width * 4, (y + 1) * width * 4)
  }

  squared = nativeImage.createFromBuffer(dst, { width: side, height: side })
  return squared
}

/**
 * 20px, for the notification area.
 *
 * Not 16: Windows renders the tray at the system DPI, and a 16px source goes
 * soft on any display above 100% scaling. 20 is the smallest that stays crisp
 * at 125%, which is the common case.
 */
export function trayIcon(): NativeImage {
  const full = appIcon()
  if (full.isEmpty()) return full
  return full.resize({ width: 20, height: 20, quality: 'best' })
}
