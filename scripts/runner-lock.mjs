import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

// Keep a stable lock file: its existence is harmless; macOS owns the lock.
// The holder exits when this runner closes its pipe, including after SIGKILL.
export async function acquireRunnerLock(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  // A separate process group keeps Ctrl-C from releasing the lock before cleanup.
  const holder = spawn('/usr/bin/lockf', ['-k', '-s', '-t', '0', join(directory, 'guard'),
    process.execPath, '-e', "process.stdout.write('locked\\n'); process.stdin.resume(); process.stdin.on('end', () => process.exit(0))"],
  { detached: true, stdio: ['pipe', 'pipe', 'inherit'] })
  const exited = new Promise(resolve => holder.once('exit', resolve))
  holder.stdin.on('error', () => {})
  await new Promise((resolve, reject) => {
    holder.once('error', reject)
    holder.stdout.once('data', resolve)
    holder.once('exit', code => reject(new Error(code === 75
      ? 'Another Trilly runner is active. Stop it before starting a second runner.'
      : `Could not acquire the Trilly runner lock (${code}).`)))
  })
  return async () => { holder.stdin.end(); await exited }
}
