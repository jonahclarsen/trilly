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

test('payee searches retain the exact two-word store alongside full-query matches', () => {
  const options = [option('Whole Foods'), option('Whole Foods 123'), option('Whole Foods 456'), option('Whole'), option('Other Whole Foods'), option('Whole Foods Market'), option('Unrelated', 0, 'Whole Foods')]
  assert.deepEqual(names(pickerResults(options, 'whole foods 123', false, true)), ['Whole Foods', 'Whole Foods 123'])
  assert.deepEqual(names(pickerResults(options, 'whole foods branch downtown', false, true)), ['Whole Foods'])
  assert.deepEqual(names(pickerResults(options, 'whole food 123', false, true)), [])
  assert.deepEqual(names(pickerResults(options, 'whole 123', false, true)), [])
})

test('two-word payee fallback ignores case and repeated whitespace', () => {
  assert.deepEqual(names(pickerResults([option(' WHOLE  Foods ')], '  Whole   FOODS  123  ', false, true)), [' WHOLE  Foods '])
})

test('two-word fallback does not change account or category searches', () => {
  const options = [option('Whole Foods'), option('Whole Foods 123')]
  assert.deepEqual(names(pickerResults(options, 'whole foods 123')), ['Whole Foods 123'])
  assert.deepEqual(names(pickerResults(options, 'whole foods 123', true)), ['Whole Foods 123'])
})
