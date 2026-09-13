import assert from 'node:assert/strict'
import test from 'node:test'
import { reviewSelection } from '../src/lib/review-selection.ts'

const current = { payee: 'manual-payee', newPayee: null, category: 'manual-category' }
const suggestion = { payee_id: 'suggested-payee', category_id: 'suggested-category' }

test('suggestions fill only fields that have not been manually fixed', () => {
  for (const payee of [false, true]) for (const category of [false, true]) {
    assert.deepEqual(reviewSelection(current, { payee, category }, suggestion), {
      payee: payee ? 'manual-payee' : 'suggested-payee',
      newPayee: null,
      category: category ? 'manual-category' : 'suggested-category',
    })
  }
})

test('a newly created payee survives category suggestions', () => {
  assert.deepEqual(reviewSelection({ ...current, payee: null, newPayee: 'Synthetic shop' }, { payee: true, category: false }, suggestion), {
    payee: null, newPayee: 'Synthetic shop', category: 'suggested-category',
  })
})

test('ordinary approval preserves all current selections regardless of fixed state', () => {
  assert.deepEqual(reviewSelection(current, { payee: false, category: false }), current)
})
