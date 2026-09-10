import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { acquireRunnerLock } from './runner-lock.mjs'

test('legacy empty directories and retained lock files allow startup; live runners exclude competitors', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'trilly-lock-test-'))
  try {
    const release = await acquireRunnerLock(directory)
    try { await assert.rejects(acquireRunnerLock(directory), /Another Trilly runner is active/) }
    finally { await release() }
    await (await acquireRunnerLock(directory))()
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('a killed runner releases its lock without manual cleanup', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'trilly-lock-crash-'))
  const runner = spawn(process.execPath, ['--input-type=module', '-e', `
    import { acquireRunnerLock } from ${JSON.stringify(new URL('./runner-lock.mjs', import.meta.url).href)};
    await acquireRunnerLock(process.argv[1]);
    process.stdout.write('ready');
    process.stdin.resume();
  `, directory], { stdio: ['pipe', 'pipe', 'inherit'] })
  const exited = new Promise(resolve => runner.once('exit', resolve))
  try {
    await new Promise((resolve, reject) => { runner.stdout.once('data', resolve); runner.once('error', reject); runner.once('exit', () => reject(new Error('Runner exited before ready'))) })
    await assert.rejects(acquireRunnerLock(directory), /Another Trilly runner is active/)
    runner.kill('SIGKILL'); await exited
    let release
    for (let attempt = 0; attempt < 50; attempt++) {
      try { release = await acquireRunnerLock(directory); break }
      catch (error) { if (!/Another Trilly/.test(error.message)) throw error; await new Promise(resolve => setTimeout(resolve, 20)) }
    }
    assert.ok(release, 'Crash lock must release promptly')
    await release()
  } finally { runner.kill('SIGKILL'); await exited; await rm(directory, { recursive: true, force: true }) }
})
