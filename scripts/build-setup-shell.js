/**
 * Build the branded setup shell around an already-built NSIS installer.
 *
 * Run AFTER electron-builder has finished, never during it. This started life
 * as an `afterAllArtifactBuild` hook, which was tidier on paper — one command
 * produced everything — and killed two releases in a row in practice: the
 * hook's cargo build (LTO, every core) ran concurrently with electron-builder
 * uploading a 100 MB artifact, starved the two-core runner, and the upload's
 * socket sat silent past its 60-second timeout. Sequenced like this, the
 * publish finishes before cargo starts.
 *
 *   node scripts/build-setup-shell.js
 *
 * Reads release/RunePanel-Setup-<version>.exe (the update vehicle, exactly as
 * published) and emits release/RunePanel-Installer-<version>.exe — the file a
 * person downloads. The release workflow uploads it with `gh`.
 */
const { execSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const release = path.join(root, 'release')
const version = require(path.join(root, 'package.json')).version

const setup = path.join(release, `RunePanel-Setup-${version}.exe`)
if (!fs.existsSync(setup)) {
  console.error(`missing ${setup} — run electron-builder first`)
  process.exit(1)
}

const dirSize = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).reduce((total, entry) => {
    const p = path.join(dir, entry.name)
    return total + (entry.isDirectory() ? dirSize(p) : fs.statSync(p).size)
  }, 0)
const unpacked = dirSize(path.join(release, 'win-unpacked'))

console.log(`building the setup shell around ${path.basename(setup)}`)
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

const artifact = path.join(release, `RunePanel-Installer-${version}.exe`)
fs.copyFileSync(
  path.join(root, 'installer', 'target', 'release', 'rune-panel-installer.exe'),
  artifact
)
console.log(`✓ ${artifact}`)
