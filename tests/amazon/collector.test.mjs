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
const payment = (n, refund = false) => ({ id: `synthetic-payment-${n}`, marketplace: 'amazon.ca', date: '2026-09-02', amount: refund ? 10000 : -10000, currency: 'CAD', refund, payment_method: 'Visa ending in 0000', evidence: 'Synthetic payment', order_ids: [`000-0000000-${String(n).padStart(7, '0')}`] });
test('only exact Trilly origin can start jobs; ordinary Amazon tabs cannot provide data', async () => {
  const h = harness();
  await h.send({ type: 'START', job: h.job, oldest: '2026-09-01' }, 1, 'http://127.0.0.1:9999/');
  assert.equal(h.tabs.size, 2);
  await h.start();
  assert.equal(h.tabs.size, 4);
  const reply = await h.send({ type: 'TASK' }, 2);
  assert.equal(reply.job, undefined);
  await h.send({ type: 'PAGE', job: h.job, payments: [payment(1)], hasNext: true }, 2);
  assert.equal(h.tabs.size, 4);
});
test('payment pagination overlaps bounded order workers and preserves refund direction', async () => {
  const h = harness(); await h.start();
  const reader = [...h.tabs.values()].find(t => t.url.includes('amazon.ca/cpe')).id;
  await h.send({ type: 'PAGE', job: h.job, payments: Array.from({ length: 20 }, (_, n) => payment(n + 1, n === 0)), hasNext: true }, reader);
  assert.equal([...h.tabs.values()].filter(t => t.url.includes('order-details')).length, 6);
  assert.equal(h.tabs.size, 10); // 2 pre-existing + 2 readers + 6 order workers
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
