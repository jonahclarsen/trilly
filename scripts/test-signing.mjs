import { mkdtemp, rm, rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run, signingIdentity } from './app-bundle.mjs'

const dir = await mkdtemp(join(tmpdir(), 'trilly-signing-fixture-'))
const executable = join(dir, 'fixture')
const keychain = join(dir, 'synthetic.keychain')
const identity = await signingIdentity()
async function build(version, identifier, signer = identity) {
  const next = join(dir, 'fixture-next')
  await run('clang', ['-Wno-deprecated-declarations', `-DFIXTURE_VERSION=${version}`, 'tests/keychain-signing.c', '-framework', 'Security', '-framework', 'CoreFoundation', '-o', next])
  await run('/usr/bin/codesign', ['--force', '--sign', signer, '--identifier', identifier, '--options', 'runtime', '--timestamp=none', next])
  await rename(next, executable)
}
let created = false
try {
  await build(1, 'app.trilly')
  await run(executable, ['create', keychain])
  created = true
  await build(2, 'app.trilly')
  await run(executable, ['read', keychain])
  await build(3, 'app.trilly.untrusted-fixture')
  await run(executable, ['deny', keychain])
  await build(4, 'app.trilly', '-')
  await run(executable, ['deny', keychain])
  await build(5, 'app.trilly')
  await run(executable, ['delete', keychain])
  created = false
  await build(6, 'app.trilly', '-')
  await run(executable, ['create-legacy', keychain])
  created = true
  await build(7, 'app.trilly')
  await run(executable, ['read', keychain])
  await build(8, 'app.trilly')
  await run(executable, ['read', keychain])
} finally {
  if (created) {
    await build(9, 'app.trilly')
    await run(executable, ['delete', keychain])
  }
  await rm(dir, { recursive: true, force: true })
}
