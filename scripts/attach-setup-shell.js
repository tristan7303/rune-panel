/**
 * Build the branded setup shell and hand it to electron-builder as an artifact.
 *
 * Runs as `afterAllArtifactBuild` — the NSIS exe exists by now, and whatever
 * this returns is published alongside it. That is the entire reason this is a
 * hook rather than a separate script: the release workflow just runs
 * electron-builder, so a second script would be a second thing CI has to know
 * about, and the GitHub release would only carry the shell when someone
 * remembered. As a hook, `npm run dist` and `npm run release` both produce and
 * publish both artifacts, always.
 *
 * The NSIS exe stays the update vehicle (`latest.yml` points at it; the
 * in-app updater runs it with /S). The shell is what a person downloads.
 */
const { execSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

exports.default = async function attachSetupShell(buildResult) {
  const setup = buildResult.artifactPaths.find((p) => /RunePanel-Setup-[^\\/]*\.exe$/.test(p))
  if (!setup) return []

  const root = path.resolve(__dirname, '..')
  const version = require(path.join(root, 'package.json')).version
  const unpacked = dirSize(path.join(buildResult.outDir, 'win-unpacked'))

  console.log(`  • building the setup shell  payload=${path.basename(setup)}`)
  execSync('cargo build --release', {
    cwd: path.join(root, 'installer'),
    stdio: 'inherit',
    env: {
      ...process.env,
      RP_PAYLOAD: setup,
      RP_VERSION: version,
      RP_UNPACKED_BYTES: String(unpacked),
    },
  })

  const artifact = path.join(buildResult.outDir, `RunePanel-Installer-${version}.exe`)
  fs.copyFileSync(
    path.join(root, 'installer', 'target', 'release', 'rune-panel-installer.exe'),
    artifact
  )
  // Deliberately NOT handed back for electron-builder to publish. Returning it
  // put two ~100 MB uploads through electron-builder's http client at once,
  // and the v0.2.4 release died on its "Request timed out" — a long-standing
  // weakness of that uploader. The release workflow attaches this file itself
  // with `gh`, which retries properly; electron-builder keeps uploading only
  // what the updater needs.
  return []
}

function dirSize(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).reduce((total, entry) => {
    const p = path.join(dir, entry.name)
    return total + (entry.isDirectory() ? dirSize(p) : fs.statSync(p).size)
  }, 0)
}
