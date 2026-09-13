import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { purchaseHistoryLinks, paypalDescription } from '../src/lib/purchase-history.ts'

const rules = JSON.parse(readFileSync(new URL('../server/src/purchase_history.json', import.meta.url), 'utf8'))

test('merchant phrases match case-insensitively inside payee names', () => {
  for (const payee of ['Steam Purchase', 'CARD STEAM PURCHASE 123']) {
    assert.deepEqual(purchaseHistoryLinks(rules, payee).map(({ merchant, url }) => ({ merchant, url })), [
      { merchant: 'Steam', url: 'https://store.steampowered.com/account/history/' },
    ])
  }
  for (const payee of ['LONG & MCQUADE', 'Long And McQuade', 'POS Long & McQuade 456']) {
    assert.deepEqual(purchaseHistoryLinks(rules, payee).map(({ merchant, url }) => ({ merchant, url })), [
      { merchant: 'Long & McQuade', url: 'https://www.long-mcquade.com/page/tracking/' },
    ])
  }
})

test('unrelated, absent, and changed payees do not retain a link', () => {
  for (const payee of ['Steam', 'Synthetic shop', '', null]) assert.deepEqual(purchaseHistoryLinks(rules, payee), [])
  assert.equal(purchaseHistoryLinks(rules, 'Steam Purchase').length, 1)
  assert.deepEqual(purchaseHistoryLinks(rules, 'Changed payee'), [])
  assert.deepEqual(purchaseHistoryLinks(undefined, 'Steam Purchase'), [])
})

test('alternative phrases produce one link and new merchants need only registry entries', () => {
  assert.equal(purchaseHistoryLinks(rules, 'Long & McQuade / Long and McQuade').length, 1)
  const extra = { id: 'fixture', merchant: 'Fixture', url: 'https://example.com/history', payee_contains: ['TEST SHOP', 'another shop'] }
  assert.deepEqual(purchaseHistoryLinks([...rules, extra], 'a Test Shop purchase'), [extra])
  assert.deepEqual(purchaseHistoryLinks([{ ...extra, payee_contains: [''] }], 'any payee'), [])
})

test('PayPal is a fallback behind specific merchants regardless of case', () => {
  assert.equal(purchaseHistoryLinks(rules, 'CARD PayPal *Unknown')[0].url, 'https://www.paypal.com/myaccount/home')
  for (const [name, id] of [['STEAM PURCHASE', 'steam'], ['Long and McQuade', 'long-mcquade'], ['NAMECHEAP', 'namecheap']]) {
    assert.deepEqual(purchaseHistoryLinks(rules, `PayPal *${name}`).map(rule => rule.id), [id])
  }
  assert.equal(purchaseHistoryLinks(rules, 'Namecheap')[0].url, 'https://ap.www.namecheap.com/Profile/Billing/Orders')
})

test('priority supports extra levels and preserves registry order for ties', () => {
  const base = { id: 'default', merchant: 'Fixture', url: 'https://example.com', payee_contains: ['shop'] }
  const middle = { ...base, id: 'middle', priority: 10 }
  const top = { ...base, id: 'top', priority: 25 }
  const tied = { ...top, id: 'tied' }
  assert.deepEqual(purchaseHistoryLinks([base, top, middle, tied], 'Shop'), [top, tied])
  assert.deepEqual(purchaseHistoryLinks([{ ...base, priority: -5 }, base], 'Shop'), [base])
})


test('PayPal description fills only empty memos and checks original payee context', () => {
  assert.equal(paypalDescription(null, 'PAYPAL *NAMECHEAP'), 'via paypal. ')
  assert.equal(paypalDescription('', 'Namecheap', 'PayPal *NAMECHEAP'), 'via paypal. ')
  assert.equal(paypalDescription('Existing description', 'PayPal'), null)
  assert.equal(paypalDescription(' ', 'PayPal'), null)
  assert.equal(paypalDescription('via paypal. ', 'PayPal'), null)
  assert.equal(paypalDescription('', 'Namecheap', null), null)
})
