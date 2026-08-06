/**
 * Update prompt.
 *
 * A strip above the content rather than a dialog. An update is worth telling
 * you about and never worth interrupting you for — this app is usually open
 * beside a game, and a modal that steals focus mid-fight is a bug, not a
 * feature.
 *
 * Nothing downloads or installs without a click. The main process has
 * autoDownload and autoInstallOnAppQuit both off for the same reason.
 */

import { useEffect, useState, type JSX } from 'react'
import type { UpdateStatus } from '@shared/ipc'
import { CloseIcon } from './icons'

export function UpdateBanner(): JSX.Element | null {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [dismissed, setDismissed] = useState<string | null>(null)

  useEffect(() => {
    void window.rp.getUpdate().then(setStatus)
    return window.rp.onUpdateStatus(setStatus)
  }, [])

  if (!status) return null
  // Nothing to say while idle, current, checking, or in a build that cannot
  // update at all.
  if (!['available', 'downloading', 'ready'].includes(status.state)) return null
  // Dismissal is per version, so the next release speaks up again.
  if (dismissed && dismissed === status.version) return null

  return (
    <div className="update-banner" role="status">
      {status.state === 'available' && (
        <>
          <span className="update-text">
            <strong>Version {status.version}</strong> is available.
          </span>
          <button className="btn" onClick={() => window.rp.downloadUpdate()}>
            Download
          </button>
        </>
      )}

      {status.state === 'downloading' && (
        <>
          <span className="update-text">Downloading {status.version}…</span>
          <span className="update-bar">
            <span className="update-bar-fill" style={{ width: `${status.progress}%` }} />
          </span>
          <span className="update-percent">{status.progress}%</span>
        </>
      )}

      {status.state === 'ready' && (
        <>
          <span className="update-text">
            <strong>Version {status.version}</strong> is ready. Rune Panel will restart.
          </span>
          <button className="btn" onClick={() => window.rp.installUpdate()}>
            Restart and install
          </button>
        </>
      )}

      {/* Downloading is the one state without a dismiss: hiding a transfer in
          progress leaves no way back to the install button. */}
      {status.state !== 'downloading' && (
        <button
          className="icon-btn"
          title="Not now"
          aria-label="Dismiss"
          onClick={() => setDismissed(status.version)}
        >
          <CloseIcon />
        </button>
      )}
    </div>
  )
}
