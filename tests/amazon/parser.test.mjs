import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import '../../chromium-extension/parser.js';
const p = globalThis.TrillyAmazonParser;
const id = '000-0000000-0000001';
const url = `https://www.amazon.ca/gp/your-account/order-details?orderID=${id}`;
const dom = html => parseHTML(html).document;
const product = (name, quantity = 1) => `<div class="a-fixed-left-grid">
  <div data-component="itemImage"><img src="https://m.media-amazon.com/images/I/synthetic.jpg"></div>
  <div data-component="itemTitle"><a href="/dp/SYNTHETIC">  ${name}\n </a></div>
  <div data-component="quantity">Quantity: ${quantity}</div>
  <div data-component="unitPrice"><span class="a-offscreen">$10.00</span><span aria-hidden="true">$10.00</span></div>
  <div data-component="orderedMerchant">Sold by: Synthetic seller</div>
  <div data-component="itemReturnEligibility">Return window open</div>
</div>`;
export const orderHTML = `<div data-component="orderId">${id}</div><div data-component="orderDate">September 1, 2026</div>
  <div data-testid="payment-instrument-name">Visa ending in 0000</div>
  <div data-component="shippingAddress">DO NOT CAPTURE THIS ADDRESS</div>
  <div class="od-line-item-row"><div class="od-line-item-row-label">Grand Total:</div><div class="od-line-item-row-content">CA$30.00</div></div>
  <div data-component="shipmentsLeftGrid"><div data-component="shipmentStatus">Delivered September 4</div>${product('USB Cable', 2)}${product('Notebook')}</div>
  <script>UNTRUSTED SCRIPT</script>`;
const paymentHTML = (amount, refund = '', order = id) => `<div class="apx-transactions-line-item-component-container">
  <span class="a-size-base-plus a-text-bold">${amount}</span><span>${refund}</span>
  <span>Visa ending in 0000</span><a class="a-link-normal" href="/gp/your-account/order-details?orderID=${order}">Order ${order}</a></div>`;
test('order cards retain products, quantities, prices, totals and shipment details, without HTML or address', () => {
  const result = p.order(dom(orderHTML), url);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].title, 'USB Cable');
  assert.equal(result.items[0].quantity, 2);
  assert.equal(result.items[0].unit_price, 10000);
  assert.equal(result.total, 30000);
  assert.equal(result.currency, 'CAD');
  assert.equal(result.date, '2026-09-01');
  assert.equal(result.items[0].status, 'Delivered September 4');
  assert.equal(result.items[1].product_url, 'https://www.amazon.ca/dp/SYNTHETIC');
  assert.doesNotMatch(JSON.stringify(result), /DO NOT CAPTURE|UNTRUSTED SCRIPT|<script/);
});
test('payments reuse the working bank-to-csv selector and distinguish refunds with stable IDs', () => {
  const html = `<h3>September 2, 2026</h3>${paymentHTML('$30.00')}${paymentHTML('+$10.00', 'Refund')}<button>Next page</button>`;
  const result = p.payments(dom(html), url);
  assert.equal(result.payments[0].date, '2026-09-02');
  // Date headings apply to subsequent rows as well as the first row.
  assert.equal(result.payments[1].date, '2026-09-02');
  assert.equal(result.payments[0].amount, -30000);
  assert.equal(result.payments[1].amount, 10000);
  assert.equal(result.payments[1].refund, true);
  assert.equal(result.payments[0].payment_method, 'Visa ending in 0000');
  assert.equal(result.next.tagName, 'BUTTON');
  assert.deepEqual(p.payments(dom(html), url).payments, result.payments);
});
test('same-value payment occurrences stay distinct; marketplace and currency are retained', () => {
  const result = p.payments(dom(`<h3>Sep 2, 2026</h3>${paymentHTML('US$30.00')}${paymentHTML('US$30.00')}`), url);
  assert.notEqual(result.payments[0].id, result.payments[1].id);
  assert.equal(result.payments[0].marketplace, 'amazon.ca');
  assert.equal(result.payments[0].currency, 'USD');
  assert.equal(p.currency('$30.00', 'amazon.com'), 'USD');
});
test('money uses milliunits and date parsing rejects impossible or ambiguous dates', () => {
  assert.equal(p.money('CA$1,234.56'), 1234560);
  assert.equal(p.money('-$0.10'), -100);
  assert.equal(p.date('February 30, 2026'), '');
  assert.equal(p.date('09/01/2026'), '');
  assert.equal(p.date('1 September 2026'), '2026-09-01');
});
test('hostile links cannot become product or order links', () => {
  assert.equal(p.market('https://amazon.ca.evil.test'), null);
  assert.equal(p.safeURL('javascript:alert(1)', url), '');
  assert.equal(p.safeURL('https://user@amazon.ca/', url), '');
  assert.equal(p.safeURL('https://amazon.com/', url), '');
  const result = p.order(dom(orderHTML.replace('/dp/SYNTHETIC', 'javascript:alert(1)')), url);
  assert.equal(result.items[0].product_url, '');
});
