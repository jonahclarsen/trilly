import assert from 'node:assert/strict'
import test from 'node:test'
import { pickerResults } from '../src/lib/picker-search.ts'
const option = (name, transactionCount = 0, detail = '') => ({ id: name, name, transactionCount, detail })
const names = options => options.map(o => o.name)

test('category prefixes outrank frequency, then frequency outranks alphabetical order', () => {
  const options = [option('Other coffee', 500), option('Coffee beans', 2), option('Coffee shops', 20), option('Coffee equipment', 2), option('Tea', 1000, 'Coffee'), option('Groceries', 2000)]
  assert.deepEqual(names(pickerResults(options, ' COF ', true)), ['Coffee shops', 'Coffee beans', 'Coffee equipment', 'Tea', 'Other coffee'])
  assert.equal(options[0].name, 'Other coffee', 'does not reorder input')
})

test('empty query ranks all categories by count then name, with missing counts treated as zero', () => {
  assert.deepEqual(names(pickerResults([option('Travel', 5), { id: 'food', name: 'Food' }, option('Bills')], '', true)), ['Travel', 'Bills', 'Food'])
})

test('ranking happens before the result limit', () => {
  const options = Array.from({ length: 70 }, (_, i) => option(`Other food ${i}`, 100))
  options.push(option('Food'))
  const results = pickerResults(options, 'food', true)
  assert.equal(results.length, 60)
  assert.equal(results[0].name, 'Food')
})

test('other pickers retain input order and group searches still match', () => {
  const options = [option('Zebra', 0, 'Everyday'), option('Alpha', 10, 'Everyday')]
  assert.deepEqual(pickerResults(options, 'every'), options)
  assert.deepEqual(pickerResults(options, 'missing', true), [])
})
