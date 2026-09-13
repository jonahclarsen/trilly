import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';

const parser = readFileSync(new URL('../../chromium-extension/parser.js', import.meta.url), 'utf8');
const collector = readFileSync(new URL('../../chromium-extension/collector.js', import.meta.url), 'utf8');

test('stable order is saved despite changing collection timestamps', async () => {
  const { document } = parseHTML(`<div class="a-fixed-left-grid"><div data-component="itemTitle">Synthetic cable</div></div>
    <div class="od-line-item-row"><span class="od-line-item-row-label">Grand Total</span><span class="od-line-item-row-content">$10.00</span></div>`);
  let now = 0, timer;
  const messages = [];
  const context = vm.createContext({
    document, URL,
    location: { href: 'https://www.amazon.ca/gp/your-account/order-details?orderID=000-0000000-0000001' },
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } },
    setTimeout: fn => { timer = fn; return 1; }, clearTimeout: () => { timer = undefined; },
    MutationObserver: class { observe() {} disconnect() {} },
    chrome: { runtime: {
      onMessage: { addListener() {} },
      async sendMessage(message) {
        if (message.type === 'TASK') return { job: 'synthetic-job', kind: 'order' };
        messages.push(message); return {};
      },
    } },
  });
  vm.runInContext(parser, context);
  vm.runInContext(collector, context);
  await new Promise(resolve => setImmediate(resolve));
  for (let i = 0; i < 180 && timer; i++) {
    now += 350;
    const next = timer; timer = undefined;
    await next();
  }
  assert.deepEqual(messages.map(m => m.type), ['PAGE']);
  assert.equal(messages[0].order.items[0].title, 'Synthetic cable');
  assert.ok(now < 60000);
});

test('extension bridge reports its installed version, including mismatches', async () => {
  const source = readFileSync(new URL('../../chromium-extension/bridge.js', import.meta.url), 'utf8');
  for (const version of ['1.0.1', '1.0.0']) {
    let receive;
    const emitted = [];
    const window = { addEventListener: (_, fn) => { receive = fn; }, postMessage: m => emitted.push(m) };
    const origin = 'http://127.0.0.1:28753';
    vm.runInNewContext(source, {
      location: { origin }, window,
      chrome: { runtime: { getManifest: () => ({ version }), onMessage: { addListener() {} }, sendMessage: async () => ({ ok: true }) } },
    });
    receive({ source: window, origin, data: { source: 'trilly-amazon-app', type: 'PING' } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(emitted[0].type, 'READY');
    assert.equal(emitted[0].version, version);
  }
});
