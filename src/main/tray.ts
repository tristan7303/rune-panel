/**
 * System tray.
 *
 * Not cosmetic: the window is frameless and hidden from the taskbar, so without
 * a tray entry there is no way to quit short of Task Manager. It exists from the
 * first runnable build for that reason.
 */

import { Tray, Menu, nativeImage } from 'electron'
import { trayIcon } from './icon'
import { getWindow, show } from './window'

let tray: Tray | null = null

export function createTray(hotkey: string): Tray {
  const image = trayIcon()
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image)

  tray.setToolTip('Rune Panel')
  tray.on('click', show)
  setHotkey(hotkey)

  return tray
}

/**
 * Rebuild the menu so the displayed accelerator matches the live binding.
 *
 * Only the label is affected — the accelerator here is decoration, since the
 * real registration happens through globalShortcut — but a menu advertising a
 * shortcut that no longer works is worse than one showing none.
 */
export function setHotkey(hotkey: string): void {
  tray?.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open', accelerator: hotkey, click: show },
      { type: 'separator' },
      { label: 'Toggle DevTools', click: () => getWindow()?.webContents.toggleDevTools() },
      { type: 'separator' },
      { label: 'Quit', role: 'quit' },
    ])
  )
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
