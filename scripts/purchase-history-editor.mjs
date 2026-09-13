import { readFile, writeFile, rename, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const relative = 'server/src/purchase_history.json'
const revision = text => createHash('sha256').update(text).digest('hex')

export function validateRules(rules) {
  if (!Array.isArray(rules) || rules.length > 500) throw new Error('Use a list of at most 500 merchants.')
  const ids = new Set()
  return rules.map(rule => {
    if (!rule || typeof rule !== 'object') throw new Error('Invalid merchant.')
    const { id, merchant, url, payee_contains, priority = 0 } = rule
    if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(id) || ids.has(id)) throw new Error('IDs must be unique lowercase letters, numbers and hyphens.')
    ids.add(id)
    if (typeof merchant !== 'string' || !merchant.trim() || merchant.length > 200) throw new Error('Each merchant needs a label (up to 200 characters).')
    let parsed
    try { parsed = new URL(url) } catch { throw new Error('Each merchant needs an HTTPS URL.') }
    if (typeof url !== 'string' || url.length > 2000 || parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password) throw new Error('Use HTTPS URLs without embedded credentials.')
    if (!Array.isArray(payee_contains) || !payee_contains.length || payee_contains.length > 100 || payee_contains.some(p => typeof p !== 'string' || !p.trim() || p.length > 200)) throw new Error('Add at least one nonempty payee phrase per merchant (up to 200 characters each).')
    if (!Number.isInteger(priority) || priority < -2147483648 || priority > 2147483647) throw new Error('Priority must be a 32-bit whole number.')
    return { id, merchant: merchant.trim(), payee_contains: payee_contains.map(p => p.trim()), url, priority }
  })
}

export function createRulesStore(root) {
  const path = resolve(root, relative)
  const git = (...args) => exec('git', args, { cwd: root, timeout: 30000, maxBuffer: 1024 * 1024 })
  let busy = false
  async function read() {
    const text = await readFile(path, 'utf8')
    return { rules: validateRules(JSON.parse(text)), revision: revision(text) }
  }
  return { read, async save(input) {
    if (busy) throw new Error('Another save is running. Retry shortly.')
    busy = true
    try {
      const rules = validateRules(input.rules)
      const current = await read()
      if (input.revision !== current.revision) throw new Error('The file changed since you opened it. Reload the file before saving.')
      await git('ls-files', '--error-unmatch', '--', relative)
      await git('symbolic-ref', '--quiet', 'HEAD')
      const conflicts = await git('diff', '--name-only', '--diff-filter=U')
      if (conflicts.stdout.trim()) throw new Error('Resolve Git conflicts before saving.')
      const text = JSON.stringify(rules, null, 2) + '\n'
      const temp = `${path}.${randomUUID()}.tmp`
      try {
        await writeFile(temp, text, { flag: 'wx' })
        if ((await read()).revision !== current.revision) throw new Error('The file changed while saving. Reload the file before saving.')
        await rename(temp, path)
      }
      finally { await unlink(temp).catch(() => {}) }
      const result = { rules, revision: revision(text) }
      try {
        const diff = await git('diff', 'HEAD', '--', relative)
        if (!diff.stdout) return { ...result, message: 'No changes to commit.' }
        await git('commit', '--only', '-m', 'Update purchase history rules', '--', relative)
        return { ...result, message: 'Saved and committed.' }
      } catch {
        return { ...result, error: 'File saved, but Git could not commit it. Check Git identity, hooks, or locks, then retry Save and commit.' }
      }
    } finally { busy = false }
  } }
}

export function purchaseHistoryEditor(root, origin) {
  const store = createRulesStore(root)
  return {
    name: 'trilly-purchase-history-editor',
    configureServer(server) {
      server.middlewares.use('/__dev/purchase-history', async (req, res) => {
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('Cache-Control', 'no-store')
        const reply = (status, data) => { res.statusCode = status; res.end(JSON.stringify(data)) }
        if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin) || req.headers['sec-fetch-site'] === 'cross-site' || req.headers['x-trilly-editor'] !== '1') return reply(403, { error: 'Request blocked.' })
        try {
          if (req.method === 'GET') return reply(200, await store.read())
          if (req.method !== 'POST') return reply(405, { error: 'Method not allowed.' })
          if (req.headers.origin !== origin || req.headers['content-type'] !== 'application/json') return reply(403, { error: 'Request blocked.' })
          let body = ''
          for await (const chunk of req) {
            body += chunk.toString()
            if (Buffer.byteLength(body) > 256000) return reply(413, { error: 'Rules file is too large.' })
          }
          const result = await store.save(JSON.parse(body))
          server.ws.send({ type: 'custom', event: 'trilly:purchase-history', data: result.rules })
          reply(200, result)
        } catch (error) { reply(400, { error: error.message || 'Unable to read or save rules.' }) }
      })
    },
  }
}
