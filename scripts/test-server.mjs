import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
// This server can only create an isolated, synthetic vault. It never opens the
// user's normal application data directory, and Playwright refuses port reuse.
const dir = await mkdtemp(join(tmpdir(), 'trilly-synthetic-'))
const child = spawn('cargo', ['run', '--features', 'synthetic-tests', '--manifest-path', 'server/Cargo.toml'], {
  stdio: 'inherit', env: { ...process.env, TRILLY_DATA_DIR: dir, TRILLY_SYNTHETIC_TESTS: '1' },
})
let stopped = false
async function cleanup() {
  if (stopped) return
  stopped = true
  child.kill('SIGINT')
}
process.on('SIGINT', cleanup)
process.on('SIGTERM', cleanup)
child.on('exit', async code => { await rm(dir, { recursive: true, force: true }); process.exit(code ?? 0) })
