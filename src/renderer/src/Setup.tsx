/**
 * First-run setup.
 *
 * Shown instead of the app, once, because the app is not usable before it
 * finishes — search over an empty index returns nothing, and nothing is exactly
 * what a broken app returns too. Better to say what is happening and how long
 * it takes than to start silently and let the first search look like a fault.
 *
 * The two optional steps are checkboxes rather than a decision buried in
 * settings: they cost about a minute between them and are worth it, but nobody
 * should be made to wait for a head start they did not ask for.
 */

import { useEffect, useState, type JSX } from 'react'
import type { SetupProgress } from '@shared/ipc'
import mark from './assets/mark.png'

const STEP_LABEL: Record<string, string> = {
  titles: 'Downloading page names',
  prices: 'Fetching item prices',
  done: 'Ready',
}

export function Setup({ onDone }: { onDone: () => void }): JSX.Element {
  const [prices, setPrices] = useState(true)
  const [progress, setProgress] = useState<SetupProgress | null>(null)

  useEffect(() => {
    void window.rp.getSetup().then(setProgress)
    return window.rp.onSetupProgress((p) => {
      setProgress(p)
      if (p.done) onDone()
    })
  }, [onDone])

  const running = progress?.running ?? false

  return (
    <div className="setup">
      <img className="setup-mark" src={mark} alt="Rune Panel" draggable={false} />

      {!running && !progress?.error && (
        <>
          <h1>One download to get started</h1>
          <p className="setup-lead">
            Rune Panel keeps the wiki on your machine so pages open instantly. It needs to fetch the
            list of page names once — about <strong>four minutes</strong>. You only do this again if
            you delete the cache.
          </p>

          <ul className="setup-options">
            <li>
              <span>
                <strong>Page names</strong>
                <em>Required — search cannot work without it. ~4 minutes.</em>
              </span>
              <span className="setup-required">Required</span>
            </li>
            <li>
              <label>
                <input type="checkbox" checked={prices} onChange={(e) => setPrices(e.target.checked)} />
                <span>
                  <strong>Item prices</strong>
                  <em>Grand Exchange prices show immediately on item pages. A few seconds.</em>
                </span>
              </label>
            </li>
          </ul>

          <button className="btn setup-go" onClick={() => window.rp.runSetup({ prices })}>
            Start download
          </button>

          <p className="setup-note">
            Requests go to the OSRS Wiki at a deliberately slow rate. You can keep using the window
            while it runs, though search stays empty until the first step finishes.
          </p>
        </>
      )}

      {running && progress && (
        <>
          <h1>{STEP_LABEL[progress.step] ?? 'Working'}</h1>
          <p className="setup-lead">{progress.detail}</p>

          <div
            className="setup-bar"
            role="progressbar"
            aria-valuenow={progress.percent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="setup-bar-fill" style={{ width: `${progress.percent}%` }} />
          </div>
          <p className="setup-percent">{progress.percent}%</p>

          <p className="setup-note">
            This is one long download, not a hung app. Leave it running — the window can be closed
            and it will carry on.
          </p>
        </>
      )}

      {progress?.error && !running && (
        <>
          <h1>The download stopped</h1>
          <p className="setup-lead">{progress.detail}</p>
          <p className="setup-note">
            Whatever arrived was kept, so trying again resumes rather than starting over.
          </p>
          <button className="btn setup-go" onClick={() => window.rp.runSetup({ prices })}>
            Try again
          </button>
        </>
      )}
    </div>
  )
}
