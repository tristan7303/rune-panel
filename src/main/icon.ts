/**
 * The app icon, in the two sizes Windows asks for.
 *
 * One 492px source, resized at runtime rather than checked in at several sizes:
 * Electron's `nativeImage.resize` uses the same scaler either way, and one file
 * cannot drift out of step with the others.
 */

import { app, nativeImage, type NativeImage } from 'electron'
import { join } from 'path'

function iconPath(): string {
  // Packaged builds get resources/ copied next to the app; in dev it sits at
  // the project root, two levels up from out/main.
  return app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(__dirname, '../../resources/icon.png')
}

/** Full-size, for the window and taskbar. */
export function appIcon(): NativeImage {
  return nativeImage.createFromPath(iconPath())
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
