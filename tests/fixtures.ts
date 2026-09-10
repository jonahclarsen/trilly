import type { Page } from '@playwright/test'
import type { Snapshot, Transaction, Suggestion } from '../src/lib/types'

function transaction(id: string, payee: string, description: string, amount: number, category: string | null): Transaction {
  return { id, account_id: 'account', date: '2026-09-08', amount, memo: null, approved: false, cleared: 'cleared',
    payee_id: payee, payee_name: payee === 'market' ? 'Whole Foods' : 'Brew House', category_id: category,
    category_name: category === 'groceries' ? 'Groceries' : null, import_payee_name: description,
    import_payee_name_original: description, transfer_account_id: null, debt_transaction_type: null, subtransactions: [] }
}
export const synthetic: Snapshot = {
  connected: true, plans: [{ id: 'plan', name: 'Personal', currency_format: { iso_code: 'CAD' } }],
  plan_id: 'plan', account_id: 'account', accounts: [{ id: 'account', name: 'Everyday card' }, { id: 'checking', name: 'Checking' }],
  categories: [{ id: 'groceries', name: 'Groceries', category_group_name: 'Everyday' }, { id: 'dining', name: 'Dining out', category_group_name: 'Everyday' }, { id: 'coffee', name: 'Coffee', category_group_name: 'Everyday' }],
  payees: [{ id: 'market', name: 'Whole Foods' }, { id: 'cafe', name: 'Brew House' }, { id: 'restaurant', name: 'Corner Kitchen' }],
  queue: [transaction('one', 'market', 'WHOLEFDS MKT #10482 VANCOUVER BC', -84270, 'groceries'), transaction('two', 'cafe', 'SQ *BREW HOUSE VANCOUVER', -6250, null), transaction('three', 'market', 'WHOLEFDS MKT #10482 VANCOUVER BC', -19300, 'groceries')],
  pending: 0, conflicts: 0, can_undo: false, synced_at: '2026-09-09T21:00:00Z', history_count: 1842,
}
export const suggestions: Suggestion[] = [
  { payee_id: 'market', category_id: 'groceries', payee: 'Whole Foods', category: 'Groceries', count: 24, reason: '24 similar transactions' },
  { payee_id: 'market', category_id: 'dining', payee: 'Whole Foods', category: 'Dining out', count: 3, reason: '3 similar transactions' },
  { payee_id: 'restaurant', category_id: 'coffee', payee: 'Corner Kitchen', category: 'Coffee', count: 2, reason: '2 similar transactions' },
]
export async function mockApp(page: Page, options: { syncError?: boolean; special?: boolean } = {}) {
  let state = structuredClone(synthetic)
  if (options.special) state.queue[0].transfer_account_id = 'checking'
  const previous: Snapshot[] = []
  const actions: Record<string, unknown>[] = []
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    let response: unknown = {}
    if (path === '/api/status') response = { exists: true }
    else if (path === '/api/unlock') response = { session: 'synthetic-session', state }
    else if (path.startsWith('/api/suggestions/')) response = suggestions
    else if (path === '/api/state') response = state
    else if (path === '/api/action') {
      const body = route.request().postDataJSON()
      actions.push(body)
      if (body.action === 'review') {
        previous.push(structuredClone(state)); state.queue = state.queue.filter(t => t.id !== body.id); state.pending++; state.can_undo = true
      } else if (body.action === 'undo') {
        state = previous.pop() ?? state
      } else if (body.action === 'sync') {
        if (options.syncError) state.sync_error = 'YNAB is unavailable. Changes remain saved locally.'
        else { state.pending = 0; delete state.sync_error }
      } else if (body.action === 'account') {
        state.account_id = body.id; state.queue = []
      }
      response = body.action === 'lock' ? { locked: true } : state
    }
    await route.fulfill({ json: response })
  })
  await page.goto('/')
  await page.getByLabel('Passphrase', { exact: true }).fill('synthetic test passphrase')
  await page.getByRole('button', { name: 'Unlock', exact: true }).click()
  await page.getByRole('heading', { name: 'Whole Foods', exact: true }).waitFor()
  return actions
}
