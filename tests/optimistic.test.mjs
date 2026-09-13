import assert from 'node:assert/strict'
import test from 'node:test'
import { project } from '../src/lib/optimistic.ts'

const row = { id: 'one', account_id: 'account', memo: null, date: '2026-01-01', amount: -1000 }
const initial = () => ({ queue: [{ ...row }], review_rows: [{ ...row }], undo_transactions: [], accounts: [{ id: 'account', name: 'Synthetic' }], plan_id: 'plan', account_id: 'account', payees: [], categories: [], pending: 0, can_undo: false })
const description = text => ({ body: { action: 'description', id: 'one', description: text } })

test('description appears in both views without mutating confirmed state; undo restores it', () => {
  const saved = initial()
  const optimistic = project(saved, description('Supplies'))
  assert.equal(optimistic.queue[0].memo, 'Supplies')
  assert.equal(optimistic.review_rows[0].memo, 'Supplies')
  assert.equal(saved.queue[0].memo, null)
  assert.deepEqual(optimistic.description_pending, ['one'])
  assert.equal(optimistic.pending, 1)
  const undone = project(optimistic, { body: { action: 'undo' }, restore: optimistic.undo_transactions.at(-1) })
  assert.equal(undone.queue[0].memo, null)
  assert.deepEqual(undone.description_pending, [])
  assert.equal(undone.pending, 0)
})

test('newer description survives an older response and approval advances immediately', () => {
  const response = project(initial(), description('First'))
  const queued = [description('Second'), { body: { action: 'review', id: 'one' } }]
  const projected = queued.reduce(project, response)
  assert.equal(projected.queue.length, 0)
  assert.equal(projected.review_rows[0].memo, 'Second')
  assert.equal(projected.review_rows[0].approved, true)
  assert.equal(response.queue[0].memo, 'First')
  assert.equal(response.pending, 1)
})

test('empty descriptions clear text and unchanged descriptions create no undo', () => {
  const saved = initial()
  assert.equal(project(saved, description('')).can_undo, false)
  saved.queue[0].memo = 'Old'; saved.review_rows[0].memo = 'Old'
  assert.equal(project(saved, description('')).queue[0].memo, '')
})

test('business expense is immediately available and survives a following approval', () => {
  const saved = initial()
  const expense = { body: { action: 'business_expense', id: 'one', description: ' Supplies ', note: 'Synthetic note' } }
  const projected = [expense, { body: { action: 'review', id: 'one' } }].reduce(project, saved)
  assert.deepEqual(projected.business_expenses, [{ plan_id: 'plan', transaction_id: 'one', description: 'Supplies', note: 'Synthetic note', date: '2026-01-01', amount: 1000, account: 'Synthetic', archived: false }])
  assert.equal(projected.can_undo_business, true)
  assert.equal(saved.business_expenses, undefined)
  assert.equal(projected.queue.length, 0)
})
