import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import { webcrypto } from 'node:crypto';
const directory = new URL('../../chromium-extension/', import.meta.url);
function harness() {
  let listener, nextTab = 10;
  const tabs = new Map([[1, { id: 1, url: 'http://127.0.0.1:28753/' }], [2, { id: 2, url: 'https://www.amazon.ca/' }]]);
  const messages = [], saved = {};
  const chrome = {
    storage: { session: { get: async key => ({ [key]: saved[key] }), set: async value => Object.assign(saved, structuredClone(value)), remove: async key => { delete saved[key]; } } },
    runtime: { onMessage: { addListener: fn => listener = fn } },
    tabs: {
      create: async fields => { const tab = { id: nextTab++, ...fields }; tabs.set(tab.id, tab); return tab; },
      update: async (id, fields) => { Object.assign(tabs.get(id), fields); return tabs.get(id); },
      remove: async id => { tabs.delete(id); },
      reload: async () => {},
      sendMessage: async (id, message) => { messages.push({ id, ...structuredClone(message) }); return { ok: true }; },
      onRemoved: { addListener: () => {} },
    },
    windows: { create: async () => { const tab = await chrome.tabs.create({ url: 'about:blank' }); return { id: 100, tabs: [tab] }; }, update: async () => {} },
    alarms: { create: async () => {}, clear: async () => {}, onAlarm: { addListener: () => {} } },
  };
  const context = vm.createContext({ chrome, URL, Date, structuredClone, crypto: webcrypto, AbortSignal, btoa, fetch: () => { throw new Error('No network in synthetic tests'); } });
  context.importScripts = name => vm.runInContext(fs.readFileSync(new URL(name, directory), 'utf8'), context);
  vm.runInContext(fs.readFileSync(new URL('background.js', directory), 'utf8'), context);
  const send = (message, tab = 1, url) => new Promise(resolve => listener(message, { frameId: 0, tab: tabs.get(tab) || { id: tab }, url: url || tabs.get(tab)?.url }, resolve));
  const job = 'synthetic-collection-0001';
  const start = () => send({ type: 'START', job, oldest: '2026-09-01', cached: [] });
  return { chrome, tabs, messages, saved, send, start, job };
}
const payment = (n, refund = false) => ({ id: `synthetic-payment-${n}`, marketplace: 'amazon.ca', date: '2026-09-02', amount: refund ? 10000 : -10000, currency: 'CAD', refund, payment_method: 'Visa ending in 0000', evidence: 'Synthetic payment', order_marketplaces: { [`000-0000000-${String(n).padStart(7, '0')}`]: 'amazon.ca' }, order_ids: [`000-0000000-${String(n).padStart(7, '0')}`] });
test('only exact Trilly origin can start jobs; ordinary Amazon tabs cannot provide data', async () => {
  const h = harness();
  await h.send({ type: 'START', job: h.job, oldest: '2026-09-01' }, 1, 'http://127.0.0.1:9999/');
  assert.equal(h.tabs.size, 2);
  await h.start();
  assert.equal(h.tabs.size, 3);
  const reply = await h.send({ type: 'TASK' }, 2);
  assert.equal(reply.job, undefined);
  await h.send({ type: 'PAGE', job: h.job, payments: [payment(1)], hasNext: true }, 2);
  assert.equal(h.tabs.size, 3);
});
test('payment pagination overlaps bounded order workers and preserves refund direction', async () => {
  const h = harness(); await h.start();
  const reader = [...h.tabs.values()].find(t => t.url.includes('amazon.ca/cpe')).id;
  await h.send({ type: 'PAGE', job: h.job, payments: Array.from({ length: 20 }, (_, n) => payment(n + 1, n === 0)), hasNext: true }, reader);
  assert.equal([...h.tabs.values()].filter(t => t.url.includes('order-details')).length, 6);
  assert.equal(h.tabs.size, 9); // 2 pre-existing + 1 reader + 6 order workers
  assert.ok(h.messages.some(m => m.id === reader && m.type === 'NEXT'));
  const packet = h.messages.find(m => m.payload?.type === 'DATA').payload;
  assert.equal(packet.payments[0].refund, true);
  assert.equal(packet.payments[0].amount, 10000);
  const worker = [...h.tabs.values()].find(t => t.url.includes('order-details'));
  const task = await h.send({ type: 'TASK' }, worker.id);
  assert.equal(task.kind, 'order');
  await h.send({ type: 'PAGE', job: h.job, order: { id: new URL(worker.url).searchParams.get('orderID'), marketplace: 'amazon.ca', items: [] } }, worker.id);
  assert.equal([...h.tabs.values()].filter(t => t.url.includes('order-details')).length, 6);
  assert.ok(!h.tabs.has(worker.id));
});
test('cancellation closes only owned tabs, rejects stale results and releases session memory', async () => {
  const h = harness(); await h.start();
  const reader = [...h.tabs.values()].find(t => t.url.includes('amazon.ca/cpe')).id;
  await h.send({ type: 'STOP', job: h.job });
  assert.deepEqual([...h.tabs.keys()], [1, 2]);
  assert.equal(h.saved.trillyAmazonJob, undefined);
  await h.send({ type: 'PAGE', job: h.job, payments: [payment(1)] }, reader, 'https://www.amazon.ca/cpe/yourpayments/transactions');
  assert.equal(h.tabs.size, 2);
});
test('unacknowledged packets survive worker state saves and repeated pages pause instead of looping', async () => {
  const h = harness(); await h.start();
  const reader = [...h.tabs.values()].find(t => t.url.includes('amazon.ca/cpe')).id;
  const message = { type: 'PAGE', job: h.job, payments: [payment(1)], hasNext: true };
  await h.send(message, reader);
  assert.equal(Object.keys(h.saved.trillyAmazonJob.pending).length, 1);
  await h.send(message, reader);
  assert.match(h.saved.trillyAmazonJob.tabs[reader].paused, /repeated/);
  const packet = Object.keys(h.saved.trillyAmazonJob.pending)[0];
  await h.send({ type: 'ACK', job: h.job, packet });
  assert.equal(Object.keys(h.saved.trillyAmazonJob.pending).length, 0);
});

test('one Canadian payment reader follows Canadian orders and deduplicates order work', async () => {
  const h = harness(); await h.start();
  const readers = [...h.tabs.values()].filter(t => t.url.includes('/cpe/'));
  assert.equal(readers.length, 1);
  assert.equal(new URL(readers[0].url).hostname, 'www.amazon.ca');
  const charge = payment(1);
  const refund = { ...payment(1, true), id: 'synthetic-refund' };
  await h.send({ type: 'PAGE', job: h.job, payments: [charge, refund], hasNext: false }, readers[0].id);
  const workers = [...h.tabs.values()].filter(t => t.url.includes('order-details'));
  assert.equal(workers.length, 1);
  assert.equal(new URL(workers[0].url).hostname, 'www.amazon.ca');
  const records = h.messages.filter(m => m.payload?.type === 'DATA').flatMap(m => m.payload.payments);
  assert.equal(records.length, 2);
  assert.equal(records[0].order_marketplaces[charge.order_ids[0]], 'amazon.ca');
  await h.send({ type: 'PAGE', job: h.job, order: { id: charge.order_ids[0], marketplace: 'amazon.ca', items: [] } }, workers[0].id);
  assert.equal(h.saved.trillyAmazonJob.completed, 1);
});
test('a Canadian reader opens a US order link on com and rejects unsupported destinations', async () => {
  for (const destination of ['amazon.com', 'evil.test']) {
    const h = harness(); await h.start();
    const reader = [...h.tabs.values()].find(t => t.url.includes('amazon.ca/cpe'));
    const record = { ...payment(1), marketplace: 'amazon.ca', order_marketplaces: { [payment(1).order_ids[0]]: destination } };
    const reply = await h.send({ type: 'PAGE', job: h.job, payments: [record], hasNext: false }, reader.id);
    const workers = [...h.tabs.values()].filter(t => t.url.includes('order-details'));
    if (destination === 'amazon.com') {
      assert.equal(workers.length, 1);
      assert.equal(new URL(workers[0].url).hostname, 'www.amazon.com');
    } else {
      assert.ok(reply.error);
      assert.equal(workers.length, 0);
    }
  }
});


test('completion waits for every saved packet and replays a missed final status', async () => {
  const h = harness(); await h.start();
  const reader = [...h.tabs.values()].find(t => t.url.includes('/cpe/'));
  const record = { ...payment(1), order_ids: [], order_marketplaces: {} };
  await h.send({ type: 'PAGE', job: h.job, payments: [record], hasNext: true }, reader.id);
  await h.send({ type: 'PAGE', job: h.job, payments: [], hasNext: false }, reader.id);
  const packets = h.messages.filter(m => m.payload?.type === 'DATA').map(m => m.payload.packet);
  assert.equal(packets.length, 2);
  await h.send({ type: 'ACK', job: h.job, packet: packets[0] });
  assert.ok(h.saved.trillyAmazonJob);
  assert.ok(!h.messages.some(m => m.payload?.complete));
  await h.send({ type: 'ACK', job: h.job, packet: packets[1] });
  assert.equal(h.saved.trillyAmazonJob, undefined);
  assert.equal(h.saved.trillyAmazonFinished.payload.complete, true);
  h.messages.length = 0; // Simulate a final status that the app missed.
  await h.send({ type: 'PING', job: h.job });
  assert.equal(h.messages[0].payload.running, false);
  assert.equal(h.messages[0].payload.complete, true);
  assert.equal(h.messages[0].payload.job, h.job);
  await h.send({ type: 'STOP', job: h.job });
  assert.equal(h.saved.trillyAmazonFinished, undefined);
});

test('a vanished worker job reconciles Stop without claiming successful collection', async () => {
  const h = harness();
  await h.send({ type: 'PING', job: h.job });
  assert.equal(h.messages[0].payload.running, false);
  assert.equal(h.messages[0].payload.complete, false);
});

test('worker failures expose bounded safe diagnostics only to the Trilly origin', async () => {
  const h = harness();
  h.chrome.windows.create = async () => { throw new Error('No window with id: 123 synthetic-secret'); };
  const reply = await h.start();
  assert.ok(reply.error);
  assert.equal(reply.diagnostics.at(-1).operation, 'START');
  assert.equal(reply.diagnostics.at(-1).code, 'window_missing');
  assert.doesNotMatch(JSON.stringify(reply.diagnostics), /synthetic-secret|oldest|client|order_ids/);
  const report = await h.send({ type: 'DIAGNOSTICS' });
  assert.equal(report.diagnostics.at(-1).code, 'window_missing');
  assert.equal(h.saved.trillyAmazonDiagnostics.at(-1).code, 'window_missing');
  const foreign = await h.send({ type: 'DIAGNOSTICS' }, 1, 'http://127.0.0.1:9999/');
  assert.equal(foreign.diagnostics, undefined);
});

test('a browser storage failure leaves in-memory diagnostics available', async () => {
  const h = harness();
  h.chrome.storage.session.set = async () => { throw new Error('QUOTA_BYTES exceeded synthetic-private'); };
  const reply = await h.start();
  assert.ok(reply.error);
  const report = await h.send({ type: 'DIAGNOSTICS' });
  assert.equal(report.diagnostics.at(-1).code, 'storage_quota');
  assert.doesNotMatch(JSON.stringify(report.diagnostics), /synthetic-private/);
});
