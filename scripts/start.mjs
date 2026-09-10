import { spawn } from 'node:child_process'
import { watch } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { run, signingIdentity, prepareBundle, installBundle, appPath, assertAppStopped } from './app-bundle.mjs'

process.chdir(fileURLToPath(new URL('..', import.meta.url)))
if (process.platform !== 'darwin') throw new Error('Trilly requires macOS')
const release = process.argv.includes('--release')
const installOnly = process.argv.includes('--install-only')
// Synthetic builds are isolated from the installed app and require explicit
// fixture configuration. Cargo also refuses this feature in release builds.
const synthetic = process.argv.includes('--synthetic-tests')
if (synthetic && (release || process.env.TRILLY_SYNTHETIC_TESTS !== '1' || !process.env.TRILLY_DATA_DIR)) {
  throw new Error('Synthetic runner requires a debug build and an explicit isolated fixture directory')
}
const destination = synthetic ? join(process.env.TRILLY_DATA_DIR, 'Trilly.app') : appPath
const executable = join(destination, 'Contents/MacOS/trilly')
const lock = synthetic ? join(process.env.TRILLY_DATA_DIR, 'runner.lock')
  : join(homedir(), 'Library/Application Support/trilly-development/runner.lock')
await mkdir(join(lock, '..'), { recursive: true, mode: 0o700 })
try { await mkdir(lock) } catch (error) {
  if (error.code === 'EEXIST') throw new Error(`Another Trilly runner owns ${lock}. Stop it before starting a second runner. After a crash, remove this empty directory manually.`)
  throw error
}
let backend, vite, watcher, timer, stopping = false, building = false, dirty = false, opened = false, launchedOnce = false
let activeBuild = Promise.resolve()
async function stopBackend() {
  const child = backend
  if (!child) return
  backend = undefined
  if (child.exitCode !== null || child.signalCode !== null) return
  await new Promise(resolve => {
    const timeout = setTimeout(() => child.kill('SIGKILL'), 5000)
    child.once('exit', () => { clearTimeout(timeout); resolve() })
    child.kill('SIGINT')
  })
}
async function cleanup() {
  if (stopping) return
  stopping = true
  clearTimeout(timer); watcher?.close()
  await activeBuild.catch(() => {})
  await stopBackend()
  await vite?.close()
  await rm(lock, { recursive: true, force: true })
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void cleanup() })
function launchBackend() {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [], {
      stdio: ['inherit', 'pipe', 'inherit'],
      env: { ...process.env, TRILLY_DEV: release ? '0' : '1', TRILLY_NO_OPEN: '1' },
    })
    backend = child
    let output = '', ready = false
    child.stdout.on('data', chunk => {
      process.stdout.write(chunk)
      output = (output + chunk.toString()).slice(-2048)
      const url = output.match(/Trilly: (http:\/\/127\.0\.0\.1:\d+)/)?.[1]
      if (!ready && url) {
        ready = true
        if (!opened && process.env.TRILLY_NO_OPEN !== '1') {
          opened = true
          const browser = spawn('/usr/bin/open', [url], { stdio: 'ignore' })
          browser.on('error', () => process.stderr.write(`Open ${url} in your browser.\n`))
        }
        resolve()
      }
    })
    child.once('error', reject)
    child.once('exit', code => {
      if (!ready) reject(new Error(`Trilly failed to start (${code})`))
      if (backend === child) {
        backend = undefined
        process.exitCode = code ?? 1
        void cleanup()
      }
    })
  })
}
try {
  await assertAppStopped(destination)
  const identity = await signingIdentity()
  activeBuild = run('pnpm', ['build'])
  await activeBuild
  if (!release && !installOnly && !stopping) {
    const { startDevServer } = await import('./dev-server.mjs')
    vite = await startDevServer({ synthetic })
  }
  async function rebuild() {
    building = true
    let staging
    try {
      await run('cargo', ['build', '--manifest-path', 'server/Cargo.toml', ...(release ? ['--release'] : []), ...(synthetic ? ['--features', 'synthetic-tests'] : [])])
      if (stopping) return
      staging = await prepareBundle(identity, release, destination)
      if (stopping) return
      await stopBackend()
      await installBundle(staging, destination)
      staging = undefined
      if (!installOnly) {
        await launchBackend()
        // A restarted Rust process has a new in-memory session. Reload once;
        // the trusted app can reopen Keychain without another approval.
        if (vite && launchedOnce) vite.ws.send({ type: 'full-reload' })
        launchedOnce = true
      }
    } finally {
      if (staging) await rm(staging, { recursive: true, force: true })
      building = false
    }
  }
  function schedule() {
    dirty = true
    clearTimeout(timer)
    timer = setTimeout(() => {
      if (building || stopping) return
      dirty = false
      activeBuild = rebuild().catch(error => console.error(error.message)).finally(() => { if (dirty) schedule() })
    }, 250)
  }
  if (!stopping && !release && !installOnly) watcher = watch('server', { recursive: true }, (_event, filename) => {
    if (filename && !filename.startsWith('target/') && /(?:\.(rs|c|h)|Cargo\.(toml|lock))$/.test(filename)) schedule()
  })
  activeBuild = rebuild()
  await activeBuild
  if (dirty && !stopping) schedule()
  if (installOnly) await cleanup()
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
  await cleanup()
}
