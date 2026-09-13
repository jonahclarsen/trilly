import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createRulesStore, validateRules, purchaseHistoryEditor } from './purchase-history-editor.mjs'
const exec = promisify(execFile)
const fixture = [{ id: 'shop', merchant: 'Synthetic shop', url: 'https://example.com/orders', payee_contains: ['shop'], priority: 10 }]
async function repo(t) {
  const root = await mkdtemp(join(tmpdir(), 'trilly-rules-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const git = async (...args) => (await exec('git', args, { cwd: root })).stdout.trim()
  await git('init', '-b', 'main')
  await git('config', 'user.name', 'Synthetic Test')
  await git('config', 'user.email', 'test@example.invalid')
  await git('config', 'commit.gpgsign', 'false')
  await mkdir(join(root, 'hooks'))
  await git('config', 'core.hooksPath', join(root, 'hooks'))
  await mkdir(join(root, 'server/src'), { recursive: true })
  await writeFile(join(root, 'server/src/purchase_history.json'), JSON.stringify(fixture, null, 2) + '\n')
  await writeFile(join(root, 'other.txt'), 'original')
  await git('add', '.')
  await git('commit', '-m', 'Synthetic fixture')
  return { root, git, store: createRulesStore(root) }
}
test('commits only the entire rules file, preserving unrelated staged and unstaged work', async t => {
  const { root, git, store } = await repo(t)
  await writeFile(join(root, 'other.txt'), 'staged')
  await git('add', 'other.txt')
  await writeFile(join(root, 'other.txt'), 'unstaged')
  const current = await store.read()
  const result = await store.save({ revision: current.revision, rules: [{ ...fixture[0], merchant: 'Updated shop' }] })
  assert.equal(result.message, 'Saved and committed.')
  assert.equal(await git('diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'), 'server/src/purchase_history.json')
  assert.equal(await git('show', ':other.txt'), 'staged')
  assert.equal(await readFile(join(root, 'other.txt'), 'utf8'), 'unstaged')
  assert.equal((await store.save(result)).message, 'No changes to commit.')
  await assert.rejects(store.save({ ...current, rules: fixture }), /file changed/)
})
test('failed commit retains saved file and supports retry without losing the draft', async t => {
  const { root, store, git } = await repo(t)
  const hook = join(root, 'hooks/pre-commit')
  await writeFile(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 })
  const current = await store.read()
  const result = await store.save({ ...current, rules: [{ ...fixture[0], priority: 20 }] })
  assert.match(result.error, /File saved/)
  assert.equal((await store.read()).rules[0].priority, 20)
  assert.equal(await git('log', '-1', '--format=%s'), 'Synthetic fixture')
  await rm(hook)
  assert.equal((await store.save(result)).message, 'Saved and committed.')
})
test('invalid and duplicate rules are rejected', () => {
  for (const rules of [[...fixture, ...fixture], [{ ...fixture[0], url: 'javascript:alert(1)' }], [{ ...fixture[0], url: 'https://user:password@example.com' }], [{ ...fixture[0], payee_contains: [''] }], [{ ...fixture[0], priority: 1.5 }]]) assert.throws(() => validateRules(rules))
})
test('dev middleware blocks foreign origins, hosts, and requests without its custom header', async () => {
  let handler
  purchaseHistoryEditor('/unused', 'http://127.0.0.1:28753').configureServer({ middlewares: { use: (_, fn) => handler = fn } })
  for (const headers of [
    { host: 'evil.example', 'x-trilly-editor': '1' },
    { host: '127.0.0.1:28753', origin: 'https://evil.example', 'x-trilly-editor': '1' },
    { host: '127.0.0.1:28753' },
    { host: '127.0.0.1:28753', 'x-trilly-editor': '1', 'sec-fetch-site': 'cross-site' },
  ]) {
    const res = { setHeader() {}, end() {} }
    await handler({ headers, method: 'GET' }, res)
    assert.equal(res.statusCode, 403)
  }
})
