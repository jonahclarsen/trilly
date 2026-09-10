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
  business_expenses: [], can_undo_archive: false, undo_transactions: [], pending: 0, conflicts: 0, can_undo: false, synced_at: '2026-09-09T21:00:00Z', history_count: 1842,
}
export const suggestions: Suggestion[] = [
  { payee_id: 'market', category_id: 'groceries', payee: 'Whole Foods', category: 'Groceries', count: 24, reason: '24 similar transactions' },
  { payee_id: 'market', category_id: 'dining', payee: 'Whole Foods', category: 'Dining out', count: 3, reason: '3 similar transactions' },
  { payee_id: 'restaurant', category_id: 'coffee', payee: 'Corner Kitchen', category: 'Coffee', count: 2, reason: '2 similar transactions' },
]
export async function mockApp(page: Page, options: { syncError?: boolean; durableUndo?: boolean; special?: boolean; url?: string } = {}) {
  let state = structuredClone(synthetic)
  if (options.special) state.queue[0].transfer_account_id = 'checking'
  let undoRestore: Snapshot | undefined
  const previous: Snapshot[] = []
  const actions: Record<string, unknown>[] = []
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    let response: unknown = {}
    if (path === '/api/status') response = { exists: true, mode: 'macos' }
    else if (path === '/api/unlock') response = { session: 'synthetic-session', state }
    else if (path.startsWith('/api/suggestions/')) response = suggestions
    else if (path === '/api/state') response = state
    else if (path === '/api/action') {
      const body = route.request().postDataJSON()
      actions.push(body)
      if (body.action === 'business_expense') {
        const t = state.queue.find(t => t.id === body.id)!
        state.business_expenses!.push({ plan_id: state.plan_id, transaction_id: t.id, description: body.description.trim(), date: t.date, amount: -t.amount, account: state.accounts.find(a => a.id === t.account_id)!.name, note: body.note, archived: false })
      } else if (body.action === 'archive_business_expenses') {
        state.business_expenses!.forEach(e => e.archived = true); state.can_undo_archive = true
      } else if (body.action === 'undo_business_archive') {
        state.business_expenses!.forEach(e => e.archived = false); state.can_undo_archive = false
      } else if (body.action === 'review') {
        previous.push(structuredClone(state)); state.undo_transactions!.push(state.queue.find(t => t.id === body.id)!); state.queue = state.queue.filter(t => t.id !== body.id); state.pending++; state.can_undo = true
      } else if (body.action === 'undo') {
        state = previous.pop() ?? state
        if (options.durableUndo) {
          undoRestore = structuredClone(state)
          state.queue = state.queue.slice(1); state.pending++
        }
      } else if (body.action === 'sync') {
        if (options.syncError) state.sync_error = 'YNAB is unavailable. Changes remain saved locally.'
        else { if (undoRestore) { state = undoRestore; undoRestore = undefined }; state.pending = 0; delete state.sync_error }
      } else if (body.action === 'account') {
        state.account_id = body.id; state.queue = []
      }
      response = body.action === 'lock' ? { locked: true } : state
    }
    await route.fulfill({ json: response })
  })
  await page.goto(options.url ?? '/')
  await page.getByRole('heading', { name: 'Whole Foods', exact: true }).waitFor()
  return actions
}
