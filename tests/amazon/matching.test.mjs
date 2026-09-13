import test from 'node:test';
import assert from 'node:assert/strict';
import { amazonLinkSummary, amazonPayee, amazonCandidates, paymentHasOrder, paymentMarketplace, paymentOrderURL, automaticItems, amazonDescription, itemCombinations, isAmazon, mergeAmazon } from '../../src/lib/amazon.ts';
const t = { id: 'synthetic-bank', date: '2026-09-03', amount: -30000, payee_name: 'AMZN MKTP CA', account_id: 'synthetic-card', approved: false, transfer_account_id: null, debt_transaction_type: null };
const item = { id: 'item-a', title: 'USB CABLE', quantity: 1, unit_price: 10000, image: '' };
const item2 = { ...item, id: 'item-b', title: 'NOTEBOOK', unit_price: 20000 };
const order = { id: 'order', marketplace: 'amazon.ca', currency: 'CAD', total: 30000, fetched_at: '2026-09-02T00:00:00Z', items: [item, item2] };
const payment = { id: 'payment', marketplace: 'amazon.ca', currency: 'CAD', date: '2026-09-02', amount: -30000, refund: false, order_ids: ['order'] };
const store = { payments: [payment], orders: [order] };
test('unique payment and full-order total can suggest all products', () => {
  const candidate = amazonCandidates(store, t, 'CAD', [t])[0];
  assert.equal(candidate.confident, true);
  assert.deepEqual(automaticItems(candidate), [item, item2]);
  assert.equal(amazonDescription(automaticItems(candidate), false), 'usb cable; notebook');
});
test('duplicate payments, competing bank transactions, unknown dates and foreign currency prevent automatic assignment', () => {
  for (const [source, targets] of [
    [{ ...store, payments: [payment, { ...payment, id: 'other-payment' }] }, [t]],
    [store, [t, { ...t, id: 'other-bank', account_id: 'other-card' }]],
    [{ ...store, payments: [{ ...payment, date: '' }] }, [t]],
    [{ ...store, payments: [{ ...payment, currency: 'USD' }] }, [t]],
  ]) assert.ok(amazonCandidates(source, t, 'CAD', targets).every(c => !c.confident));
});
test('partial charge and multi-item refund never inherit all order products automatically', () => {
  for (const amount of [-10000, 30000]) {
    const target = { ...t, amount };
    const source = { ...store, payments: [{ ...payment, amount, refund: amount > 0 }] };
    assert.deepEqual(automaticItems(amazonCandidates(source, target, 'CAD', [target])[0]), []);
  }
  assert.equal(amazonDescription([item], true), 'refund for usb cable');
  assert.equal(amazonCandidates(store, { ...t, amount: 30000 }, 'CAD', [t]).length, 0);
});
test('recorded price combinations are bounded and use quantity without inventing tax', () => {
  assert.deepEqual(itemCombinations([item, item2], -20000), [['item-b']]);
  assert.deepEqual(itemCombinations([{ ...item, quantity: 2 }, item2], -20000), [['item-a'], ['item-b']]);
  assert.deepEqual(itemCombinations([item, item2], -33600), []);
  assert.deepEqual(itemCombinations(Array(16).fill(item), -10000), []);
});
test('reimports update cached orders without losing other evidence; card payments are excluded', () => {
  assert.equal(mergeAmazon(store, store).payments.length, 1);
  assert.equal(mergeAmazon(store, { payments: [], orders: [{ ...order, total: 40000 }] }).orders[0].total, 40000);
  assert.equal(isAmazon({ ...t, payee_name: 'Amazon MBNA card' }), false);
  assert.equal(isAmazon({ ...t, transfer_account_id: 'other' }), false);
});

test('a previously assigned payment is excluded for another transaction', () => {
  assert.equal(amazonCandidates(store, t, 'CAD', [t], [{ payment_id: payment.id, transaction_id: 'already-approved' }]).length, 0);
  assert.equal(amazonCandidates(store, t, 'CAD', [t], [{ payment_id: payment.id, transaction_id: t.id }]).length, 1);
});
test('link summary reports work remaining and ignores duplicate or stale assignments', () => {
  const targets = [t, { ...t, id: 'other-bank' }];
  assert.equal(amazonLinkSummary(Array.from({ length: 10 }, (_, id) => ({ ...t, id: `bank-${id}` })), []), '10 transactions to link');
  assert.equal(amazonLinkSummary(targets, []), '2 transactions to link');
  assert.equal(amazonLinkSummary(targets, [{ transaction_id: t.id }]), '1 transaction linked, 1 unlinked');
  assert.equal(amazonLinkSummary(targets, [
    { transaction_id: t.id },
    { transaction_id: t.id },
    { transaction_id: 'stale-bank' },
  ]), '1 transaction linked, 1 unlinked');
  assert.equal(amazonLinkSummary([t], []), '1 transaction to link');
});
test('generated descriptions respect the API limit without splitting Unicode characters', () => {
  const description = amazonDescription([{ ...item, title: 'A'.repeat(600) }], true);
  assert.equal([...description].length, 500);
  assert.ok(description.startsWith('refund for '));
  assert.ok(description.endsWith('…'));
});

test('cross-storefront payment matches only its linked order and suggests the destination payee', () => {
  const cross = { ...payment, marketplace: 'amazon.com', order_marketplaces: { order: 'amazon.ca' } };
  const wrong = { ...order, marketplace: 'amazon.com' };
  const candidate = amazonCandidates({ payments: [cross], orders: [order, wrong] }, t, 'CAD', [t])[0];
  assert.deepEqual(candidate.orders, [order]);
  assert.deepEqual(automaticItems(candidate), [item, item2]);
  assert.equal(paymentHasOrder(cross, order), true);
  assert.equal(paymentHasOrder(cross, wrong), false);
  assert.equal(paymentMarketplace(cross), 'amazon.ca');
  assert.equal(paymentMarketplace(payment), 'amazon.ca');
  assert.equal(paymentMarketplace({ ...cross, order_ids: ['order', 'other'] }), null);
});

test('payment order links use the first safe order and its destination storefront', () => {
  const id = '000-0000000-0000001';
  const linked = { ...payment, order_ids: ['invalid', id], order_marketplaces: { invalid: 'evil.test', [id]: 'amazon.com' } };
  assert.equal(paymentOrderURL(linked), `https://www.amazon.com/gp/your-account/order-details?orderID=${id}`);
  assert.equal(paymentOrderURL({ ...linked, order_ids: ['invalid'] }), '');
});

test('marketplace resolves an existing payee without changing its name', () => {
  const payee = { id: 'synthetic-payee', name: 'Amazon.ca' };
  assert.equal(amazonPayee([payee], 'amazon.ca'), payee);
  assert.equal(amazonPayee([payee], 'amazon.com'), undefined);
  assert.equal(amazonPayee([payee], null), undefined);
});


test('Kindle Svcs in current or imported payees receives the full Amazon matching flow', () => {
  for (const field of ['payee_name', 'import_payee_name', 'import_payee_name_original']) {
    const kindle = { ...t, payee_name: 'Digital purchase', [field]: 'KINDLE SVCS synthetic charge' };
    assert.equal(isAmazon(kindle), true);
    const candidate = amazonCandidates(store, kindle, 'CAD', [kindle])[0];
    assert.equal(candidate.confident, true);
    assert.equal(candidate.payment.id, payment.id);
    assert.deepEqual(automaticItems(candidate), [item, item2]);
    assert.equal(isAmazon({ ...kindle, transfer_account_id: 'other' }), false);
  }
  assert.equal(isAmazon({ ...t, payee_name: 'Kindle accessory shop' }), false);
});
