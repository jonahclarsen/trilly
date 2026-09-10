import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile, cp, rename, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options })
    child.once('error', reject)
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${command} failed (${signal ?? code})`)))
  })
}
function capture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', data => { output += data })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolve(output) : reject(new Error(`${command} failed (${code})`)))
  })
}

// Only public identity metadata is read. Private keys stay in macOS Keychain.
export async function signingIdentity() {
  const configDir = join(homedir(), 'Library/Application Support/trilly-development')
  const configPath = join(configDir, 'signing.json')
  const available = [...(await capture('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning']))
    .matchAll(/\) ([A-F0-9]{40}) "([^"]+)"/g)].map(match => ({ fingerprint: match[1], name: match[2] }))
  let saved
  try { saved = JSON.parse(await readFile(configPath, 'utf8')).fingerprint } catch (error) { if (error.code !== 'ENOENT') throw error }
  const requested = process.env.TRILLY_SIGNING_IDENTITY || saved
  const identity = requested ? available.find(item => item.fingerprint === requested || item.name === requested)
    : available.length === 1 ? available[0] : undefined
  if (!identity) throw new Error('Select a certificate-based signing identity with TRILLY_SIGNING_IDENTITY (name or SHA-1 fingerprint). Install one in Keychain Access if none is available. Trilly never falls back to ad-hoc signing.')
  await mkdir(configDir, { recursive: true, mode: 0o700 })
  await writeFile(configPath, JSON.stringify({ fingerprint: identity.fingerprint }, null, 2) + '\n', { mode: 0o600 })
  return identity.fingerprint
}

export const appPath = join(homedir(), 'Applications/Trilly.app')

export async function prepareBundle(identity, release = false, destination = appPath) {
  const staging = `${destination}.staging-${process.pid}`
  await rm(staging, { recursive: true, force: true })
  await mkdir(join(staging, 'Contents/MacOS'), { recursive: true })
  await mkdir(join(staging, 'Contents/Resources'), { recursive: true })
  try {
    await cp(resolve(`server/target/${release ? 'release' : 'debug'}/trilly`), join(staging, 'Contents/MacOS/trilly'))
    await cp(resolve('dist'), join(staging, 'Contents/Resources/dist'), { recursive: true })
    await writeFile(join(staging, 'Contents/Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>trilly</string>
<key>CFBundleIdentifier</key><string>app.trilly</string>
<key>CFBundleName</key><string>Trilly</string>
<key>CFBundleDisplayName</key><string>Trilly</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleShortVersionString</key><string>0.1.0</string>
<key>LSUIElement</key><true/>
</dict></plist>\n`)
    await run('/usr/bin/codesign', ['--force', '--sign', identity, '--identifier', 'app.trilly', '--options', 'runtime', '--timestamp=none', staging])
    await run('/usr/bin/codesign', ['--verify', '--strict', staging])
    return staging
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    throw error
  }
}

export async function installBundle(staging, destination = appPath) {
  const backup = `${destination}.previous-${process.pid}`
  let backedUp = false
  try {
    await rename(destination, backup)
    backedUp = true
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  try { await rename(staging, destination) } catch (error) {
    if (backedUp) await rename(backup, destination)
    throw error
  }
  await rm(backup, { recursive: true, force: true })
}

export function assertAppStopped(destination = appPath) {
  return new Promise((resolve, reject) => {
    const escaped = [...join(destination, 'Contents/MacOS/trilly')].map(char => '.^$*+?()[]{}|\\'.includes(char) ? '\\' + char : char).join('')
    const child = spawn('/usr/bin/pgrep', ['-f', '^' + escaped + '( |$)'], { stdio: 'ignore' })
    child.once('error', reject)
    child.once('exit', code => code === 1 ? resolve() : reject(new Error('Close the running Trilly app before replacing its bundle.')))
  })
}
