import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

test('order cards render complete synthetic evidence as escaped text, without remote images or active HTML', async () => {
  // Compile and render on the server. No browser, listening socket, clipboard,
  // Keychain, or native UI is used by this test.
  const server = await createServer({ configFile: false, plugins: [svelte()], server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom' });
  try {
    const { default: Card } = await server.ssrLoadModule('/src/lib/AmazonOrderCard.svelte');
    const { render } = await server.ssrLoadModule('svelte/server');
    const output = render(Card, { props: { order: {
      id: '000-0000000-0000001', marketplace: 'amazon.ca', url: 'https://www.amazon.ca/gp/your-account/order-details?orderID=000-0000000-0000001',
      date: '2026-09-01', currency: 'CAD', total: 11200, payment_method: 'Visa ending in 0000', fetched_at: '2026-09-02T00:00:00Z',
      items: [{ id: 'item', title: 'SYNTHETIC <script>bad()</script> CABLE', quantity: 2, unit_price: 5000, price_text: '$5.00', product_url: 'javascript:bad()', image: 'https://evil.test/tracker.png', seller: 'Synthetic seller', status: 'Delivered', details: 'Return window open' }],
      totals: [{ label: 'Item(s) Subtotal:', value: '$10.00' }, { label: 'Tax:', value: '$1.20' }, { label: 'Grand Total:', value: '$11.20' }],
    }, payments: [{ id: 'payment', marketplace: 'amazon.ca', amount: 11200, currency: 'CAD', date: '2026-09-02', refund: true, payment_method: 'Visa ending in 0000', order_ids: ['000-0000000-0000001'] }] } });
    for (const expected of ['synthetic &lt;script>', 'Quantity 2', 'Synthetic seller', 'Delivered', 'Tax:', 'Grand Total:', 'Refund', 'Visa ending in 0000']) assert.ok(output.body.includes(expected), expected);
    assert.doesNotMatch(output.body, /<script>|javascript:|evil\.test|<img/);
  } finally { await server.close(); }
});

test('payment details stay visible with separate fields and safe order links before order collection', async () => {
  const server = await createServer({ configFile: false, plugins: [svelte()], server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom' });
  try {
    const { default: Details } = await server.ssrLoadModule('/src/lib/AmazonPaymentDetails.svelte');
    const { render } = await server.ssrLoadModule('svelte/server');
    const { parseHTML } = await import('linkedom');
    const id = '000-0000000-0000001';
    const payment = {
      id: 'synthetic-payment', marketplace: 'amazon.com', date: '2026-09-02',
      amount: -11200, currency: 'CAD', refund: false, payment_method: 'Visa ending in 0000',
      order_ids: [id], order_marketplaces: { [id]: 'amazon.ca' },
      evidence: '$11.20Visa ending in 0000Order000-0000000-0000001',
    };
    const document = parseHTML(render(Details, { props: { payment } }).body).document;
    assert.equal(document.querySelector('details'), null);
    assert.equal(document.querySelectorAll('dl > div').length, 5);
    assert.ok([...document.querySelectorAll('dd')].some(node => node.textContent === payment.payment_method));
    assert.equal(document.querySelector('a').getAttribute('href'), `https://www.amazon.ca/gp/your-account/order-details?orderID=${id}`);
    for (const invalid of [
      { ...payment, order_marketplaces: { [id]: 'evil.test' } },
      { ...payment, order_ids: ['<script>invalid</script>'] },
    ]) {
      const output = render(Details, { props: { payment: invalid } }).body;
      assert.equal(parseHTML(output).document.querySelector('a'), null);
      assert.doesNotMatch(output, /<script>/);
    }
  } finally { await server.close(); }
});
