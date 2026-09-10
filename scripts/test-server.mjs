import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
// This server can only create an isolated, synthetic vault. It never opens the
// user's normal application data directory, and Playwright refuses port reuse.
const dir = await mkdtemp(join(tmpdir(), 'ynab-plus-synthetic-'))
const child = spawn('cargo', ['run', '--manifest-path', 'server/Cargo.toml'], {
  stdio: 'inherit', env: { ...process.env, YNAB_PLUS_DATA_DIR: dir },
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
