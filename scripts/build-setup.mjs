/**
 * Build both installer artifacts.
 *
 * 1. electron-builder produces the NSIS installer — unchanged, because it is
 *    what the in-app updater downloads and runs silently forever after.
 * 2. The Rust shell in installer/ is built with that NSIS exe embedded, plus
 *    the version and the unpacked size (which is how the shell turns "watch
 *    the install directory fill" into a percentage).
 *
 * Ships:
 *   release/RunePanel-Setup-<version>.exe   the update vehicle (+ latest.yml)
 *   release/RunePanel-Installer-<version>.exe   what a person downloads
 */
import { execSync } from 'node:child_process'
import { cpSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const release = join(root, 'release')
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version

const run = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', cwd: root, ...opts })

console.log(`\n— Rune Panel ${version}: building the NSIS engine —\n`)
run('npm run build')
run('npx electron-builder --win --publish never')

const setup = join(release, `RunePanel-Setup-${version}.exe`)
statSync(setup) // throws loudly if the build did not land where expected

const dirSize = (dir) =>
  readdirSync(dir, { withFileTypes: true }).reduce((total, entry) => {
    const path = join(dir, entry.name)
    return total + (entry.isDirectory() ? dirSize(path) : statSync(path).size)
  }, 0)
const unpacked = dirSize(join(release, 'win-unpacked'))

console.log(`\n— building the setup shell (${(unpacked / 1e6).toFixed(0)} MB unpacked) —\n`)
run('cargo build --release', {
  cwd: join(root, 'installer'),
  env: {
    ...process.env,
    RP_PAYLOAD: setup,
    RP_VERSION: version,
    RP_UNPACKED_BYTES: String(unpacked),
  },
})

const artifact = join(release, `RunePanel-Installer-${version}.exe`)
cpSync(join(root, 'installer', 'target', 'release', 'rune-panel-installer.exe'), artifact)
console.log(`\n✓ ${artifact}`)
console.log(`✓ ${setup} (update vehicle — publish alongside latest.yml, as always)`)
