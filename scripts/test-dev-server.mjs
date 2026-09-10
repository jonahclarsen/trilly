import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Exercise the real build/sign/watch runner with a separate app bundle, ports,
// and synthetic vault. The production Keychain functions are never called.
const dir = await mkdtemp(join(tmpdir(), 'trilly-dev-synthetic-'))
const child = spawn(process.execPath, ['scripts/start.mjs', '--synthetic-tests'], {
  stdio: 'inherit', env: { ...process.env, TRILLY_DATA_DIR: dir, TRILLY_SYNTHETIC_TESTS: '1', TRILLY_NO_OPEN: '1' },
})
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill('SIGINT'))
child.once('exit', async code => {
  await rm(dir, { recursive: true, force: true })
  process.exit(code ?? 0)
})
