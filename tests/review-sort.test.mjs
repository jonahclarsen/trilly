import assert from 'node:assert/strict'
import test from 'node:test'
import { sortReviewRows, orderedReviewQueue } from '../src/lib/review-sort.ts'

const row = (id, values = {}) => ({
  id, date: '2026-01-01', amount: 0, payee_name: null, import_payee_name: null,
  category_name: null, memo: null, approved: false, ...values,
})
const ids = rows => rows.map(t => t.id)
const sort = (rows, column, direction = 'ascending', skipped = []) => sortReviewRows(rows, column, direction, skipped)

test('every column sorts ascending and descending by displayed values', () => {
  for (const [column, first, last] of [
    ['date', { date: '2025-12-31' }, { date: '2026-01-02' }],
    ['payee', { import_payee_name: 'Merchant 2' }, { payee_name: 'merchant 10' }],
    ['category', { category_name: 'Food' }, { category_name: 'Travel' }],
    ['description', { memo: null }, { memo: 'Synthetic note' }],
    ['amount', { amount: -10000 }, { amount: 2000 }],
    ['status', { approved: false }, { approved: true }],
  ]) {
    const input = [row('last', last), row('first', first)]
    assert.deepEqual(ids(sort(input, column)), ['first', 'last'], column)
    assert.deepEqual(ids(sort(input, column, 'descending')), ['last', 'first'], column)
    assert.deepEqual(ids(input), ['last', 'first'], 'does not mutate the snapshot')
  }
})

test('equal values use stable date and ID ordering in either direction', () => {
  const input = [row('b'), row('a'), row('old', { date: '2025-01-01' })]
  for (const direction of ['ascending', 'descending']) {
    assert.deepEqual(ids(sort(input, 'amount', direction)), ['old', 'a', 'b'])
  }
})

test('transaction queue follows table sorting, excludes reviewed rows, and retains authoritative values', () => {
  const queue = [row('a', { amount: -100 }), row('b', { amount: 400 }), row('c', { amount: 200 })]
  const reviewed = row('done', { amount: 500, approved: true })
  const table = sort([...queue, reviewed], 'amount', 'descending')
  const ordered = orderedReviewQueue(table, queue)
  assert.deepEqual(ids(table), ['done', 'b', 'c', 'a'])
  assert.deepEqual(ids(ordered), ['b', 'c', 'a'])
  assert.equal(ordered[0], queue[1])
  assert.equal(ordered.find(t => !['b'].includes(t.id)).id, 'c')
  assert.deepEqual(ids(orderedReviewQueue(table, queue.filter(t => t.id !== 'b'))), ['c', 'a'])
  assert.deepEqual(ids(orderedReviewQueue(table, queue)), ['b', 'c', 'a'], 'undo restores position')
})

test('status orders awaiting, skipped and reviewed rows; missing labels match UI fallback text', () => {
  const rows = [row('reviewed', { approved: true }), row('skipped'), row('awaiting')]
  assert.deepEqual(ids(sort(rows, 'status', 'ascending', ['skipped'])), ['awaiting', 'skipped', 'reviewed'])
  assert.deepEqual(ids(sort([row('missing'), row('known', { payee_name: 'Zebra' })], 'payee')), ['missing', 'known'])
  assert.deepEqual(ids(sort([], 'date')), [])
})
