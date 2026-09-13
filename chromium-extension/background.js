importScripts('parser.js');
importScripts('diagnostics.js');
const DIAGNOSTICS = 'trillyAmazonDiagnostics';
let diagnosticLog = TrillyDiagnostics.create();
const diagnosticsLoaded = chrome.storage.session.get(DIAGNOSTICS).then(value => { diagnosticLog = TrillyDiagnostics.create(value[DIAGNOSTICS]); }).catch(() => {});
async function recordDiagnostic(operation, outcome, error) {
  await diagnosticsLoaded;
  diagnosticLog.record(operation, outcome, error, { pages: job?.pages || 0, orders: job?.completed || 0, queued: job?.queue.length || 0, active: Object.keys(job?.tabs || {}).length, pending: Object.keys(job?.pending || {}).length, paused: Object.values(job?.tabs || {}).filter(t => t.paused).length });
  try { await chrome.storage.session.set({ [DIAGNOSTICS]: diagnosticLog.snapshot() }); } catch { /* Keep the in-memory report if browser storage fails. */ }
}
const ORIGIN = 'http://127.0.0.1:28753';
const KEY = 'trillyAmazonJob';
const RECEIPT = 'trillyAmazonFinished';
let finished;
const ORDER_LIMIT = 6;
const TAB_LIMIT = 12;
let chain = Promise.resolve();
const serial = fn => { const next = chain.then(fn); chain = next.catch(() => {}); return next; };
let job;
const loaded = Promise.all([chrome.storage.session.get(KEY), chrome.storage.session.get(RECEIPT)]).then(([active, last]) => { job = active[KEY] || null; finished = last[RECEIPT] || null; });
const save = () => job ? chrome.storage.session.set({ [KEY]: job }) : chrome.storage.session.remove(KEY);
function client(sender) { try { return sender.frameId === 0 && new URL(sender.url).origin === ORIGIN; } catch { return false; } }
function owned(sender) { return job && sender.frameId === 0 && job.tabs[String(sender.tab?.id)] && globalThis.TrillyAmazonParser.market(sender.url) === job.tabs[String(sender.tab.id)].marketplace; }
async function emit(payload) {
  if (!job) return;
  try { await chrome.tabs.sendMessage(job.client, { source: 'trilly-amazon-worker', payload: { ...payload, job: job.id } }); }
  catch (error) { await recordDiagnostic('DELIVERY', 'error', error); await cancel(); }
}
async function status() {
  if (!job) return;
  await emit({ type: 'STATUS', running: true, pages: job.pages, orders: job.completed,
    queued: job.queue.length, active: Object.keys(job.tabs).length,
    paused: Object.entries(job.tabs).filter(([, t]) => t.paused).map(([id, t]) => ({ tab: +id, marketplace: t.marketplace, reason: t.paused })),
    message: job.notice || '' });
}
async function cancel() {
  if (!job) return;
  const tabs = [...Object.keys(job.tabs).map(Number), ...(job.parkedTab ? [job.parkedTab] : [])]; job = null; await save(); await chrome.alarms.clear('trilly-amazon');
  await Promise.all(tabs.map(id => chrome.tabs.remove(id).catch(() => {})));
}
function urlFor(marketplace, id) { return `https://www.${marketplace}/gp/your-account/order-details?orderID=${id}`; }
function priority(entry) {
  return entry.amounts?.some(amount => amount === job.priority) ? 0 : 1;
}
// Keep the final owned tab blank while saves apply backpressure. Closing it
// destroys the window, even when queued orders still need that window later.
async function retireTab(id) {
  delete job.tabs[id];
  if (!Object.keys(job.tabs).length && !job.parkedTab) {
    job.parkedTab = id;
    await save();
    await chrome.tabs.update(id, { url: 'about:blank' });
  } else {
    await save();
    await chrome.tabs.remove(id).catch(() => {});
  }
}
async function createTab(task, url, fromQueue = false) {
  if (!job || Object.keys(job.tabs).length >= TAB_LIMIT) return;
  // Create blank first, register ownership, THEN navigate to avoid a TASK race.
  const tab = job.parkedTab ? { id: job.parkedTab } : await chrome.tabs.create({ windowId: job.window, url: 'about:blank', active: false });
  delete job.parkedTab;
  job.tabs[tab.id] = { ...task, started: Date.now() };
  if (fromQueue) job.queue.shift();
  await save();
  await chrome.tabs.update(tab.id, { url });
}
async function pump() {
  if (!job) return;
  if (Object.keys(job.pending).length < 12) {
    job.queue.sort((a, b) => priority(a) - priority(b));
    while (job.queue.length && Object.values(job.tabs).filter(t => t.kind === 'order').length < ORDER_LIMIT && Object.keys(job.tabs).length < TAB_LIMIT) {
      const next = job.queue[0];
      await createTab({ kind: 'order', marketplace: next.marketplace, order: next.id }, urlFor(next.marketplace, next.id), true);
    }
    for (const [id, t] of Object.entries(job.tabs)) {
      if (t.next && !t.paused) {
        t.next = false; t.started = Date.now(); await save();
        try { const result = await chrome.tabs.sendMessage(+id, { type: 'NEXT', job: job.id }); if (result?.error) t.paused = result.error; }
        catch { t.paused = 'Next page could not be opened. Resume to retry.'; }
      }
    }
  }
  await save();
  if (!Object.keys(job.tabs).length && !job.queue.length && !Object.keys(job.pending).length) {
    // Retain only a tiny receipt so a missed terminal message can be replayed.
    finished = { client: job.client, payload: { type: 'STATUS', job: job.id, complete: !job.notice, running: false, pages: job.pages, orders: job.completed, queued: 0, active: 0, paused: [], message: job.notice || 'Amazon collection complete.' } };
    await chrome.storage.session.set({ [RECEIPT]: finished });
    await recordDiagnostic('COMPLETE', job.notice ? 'partial' : 'complete');
    await emit(finished.payload);
    await cancel(); return;
  }
  await status();
}
async function packet(records) {
  const id = crypto.randomUUID();
  // Keep restartable packets small. If the worker restarts before acknowledgement,
  // retry the textual evidence; thumbnails are optional and can be fetched again.
  job.pending[id] = structuredClone(records);
  for (const order of job.pending[id].orders) for (const item of order.items) item.image = '';
  await save();
  await emit({ type: 'DATA', packet: id, ...records });
}
async function start(message, sender) {
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(message.job) || !/^20\d{2}-\d{2}-\d{2}$/.test(message.oldest)) throw new Error('Invalid collection request');
  if (job) { if (job.client !== sender.tab.id) throw new Error('Collection is already running in another Trilly tab.'); await cancel(); }
  finished = null; await chrome.storage.session.remove(RECEIPT);
  const window = await chrome.windows.create({ url: 'about:blank', focused: false, type: 'normal' });
  job = { id: message.job, client: sender.tab.id, window: window.id, oldest: message.oldest, priority: message.priority,
    queue: [], seen: [], tabs: {}, pending: {}, pages: 0, completed: 0, notice: '',
    cached: Array.isArray(message.cached) ? message.cached.slice(0, 5000) : [] };
  // Read the shared account payment feed once; order links choose the storefront.
  const first = window.tabs[0].id;
  job.tabs[first] = { kind: 'payments', marketplace: 'amazon.ca', started: Date.now(), signatures: [], pages: 0 }; await save();
  await chrome.tabs.update(first, { url: 'https://www.amazon.ca/cpe/yourpayments/transactions' });
  await chrome.alarms.create('trilly-amazon', { periodInMinutes: 0.5 }); await status();
}
async function page(message, sender) {
  if (!owned(sender) || message.job !== job.id) return;
  const tabId = sender.tab.id, task = job.tabs[tabId];
  if (task.paused) return;
  if (task.kind === 'payments') {
    if (!Array.isArray(message.payments) || message.payments.length > 100 || message.payments.some(p => p.marketplace !== task.marketplace ||
      (p.order_marketplaces && Object.entries(p.order_marketplaces).some(([id, market]) =>
        !p.order_ids?.includes(id) || !['amazon.ca', 'amazon.com'].includes(market))))) throw new Error('Invalid payment page');
    const signature = message.payments.map(p => p.id).join('|');
    if (task.signatures.includes(signature)) { task.paused = 'Payments page repeated. Check pagination, then resume.'; await save(); await status(); return; }
    task.signatures.push(signature); task.pages++; job.pages++;
    const cutoff = new Date(job.oldest + 'T00:00:00Z').getTime() - 14 * 86400000;
    const allOlder = message.payments.length > 0 && message.payments.every(p => p.date && new Date(p.date + 'T00:00:00Z').getTime() < cutoff);
    for (const payment of message.payments) {
      if (payment.date && new Date(payment.date + 'T00:00:00Z').getTime() < cutoff) continue;
      for (const id of payment.order_ids || []) {
        if (!/^\d{3}-\d{7}-\d{7}$/.test(id)) continue;
        const marketplace = payment.order_marketplaces?.[id] || payment.marketplace;
        const key = `${marketplace}:${id}`;
        if (job.seen.includes(key)) continue;
        const cached = job.cached.find(c => c.key === key);
        // Refunds always refresh the order. Other orders refresh after 24 hours.
        if (cached && !payment.refund && Date.now() - Date.parse(cached.at) < 86400000) continue;
        if (job.seen.length >= 5000) { job.notice = 'Order limit reached. Some older details may be missing.'; continue; }
        job.seen.push(key);
        job.queue.push({ id, marketplace, amounts: message.payments.filter(p => p.order_ids.includes(id) && (p.order_marketplaces?.[id] || p.marketplace) === marketplace).map(p => p.amount) });
      }
    }
    await packet({ payments: message.payments, orders: [] }); if (!job) return;
    if (message.hasNext && !allOlder && task.pages < 100) task.next = true;
    else { if (task.pages >= 100) job.notice = 'Stopped after 100 payment pages. Older history may be incomplete.'; await retireTab(tabId); }
  } else {
    if (message.order?.id !== task.order || message.order.marketplace !== task.marketplace) throw new Error('Order page does not match requested order');
    await packet({ payments: [], orders: [message.order] }); if (!job) return;
    job.completed++; await retireTab(tabId);
  }
  await pump();
}
async function thumbnail(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || !['m.media-amazon.com', 'images-na.ssl-images-amazon.com'].includes(u.hostname) || u.username || u.password || u.port) return '';
    const response = await fetch(u.href, { credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(6000) });
    const mime = response.headers.get('content-type')?.split(';')[0];
    if (!response.ok || !['image/jpeg', 'image/png', 'image/webp'].includes(mime)) return '';
    const reader = response.body.getReader(); let size = 0; const chunks = [];
    while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 120000) { await reader.cancel(); return ''; } chunks.push(value); }
    let binary = ''; for (const chunk of chunks) for (const byte of chunk) binary += String.fromCharCode(byte);
    return `data:${mime};base64,${btoa(binary)}`;
  } catch { return ''; }
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  // Image transfers do not hold the scheduler lock or block payments pagination.
  if (message?.type === 'IMAGE') {
    loaded.then(() => owned(sender) && message.job === job.id ? thumbnail(message.url) : '').then(image => reply({ image })); return true;
  }
  serial(async () => {
    if (client(sender) && message.type === 'DIAGNOSTICS') { await diagnosticsLoaded; return { diagnostics: diagnosticLog.snapshot() }; }
    await loaded;
    if (client(sender)) {
      if (message.type === 'PING') {
        if (job?.client === sender.tab.id) { await status(); for (const [id, records] of Object.entries(job?.pending || {})) await emit({ type: 'DATA', packet: id, ...records }); }
        else if (!job && finished?.client === sender.tab.id && (!message.job || message.job === finished.payload.job)) await chrome.tabs.sendMessage(sender.tab.id, { source: 'trilly-amazon-worker', payload: finished.payload }).catch(() => {});
        else if (!job && message.job) await chrome.tabs.sendMessage(sender.tab.id, { source: 'trilly-amazon-worker', payload: { type: 'STATUS', job: message.job, running: false, complete: false, pages: 0, orders: 0, queued: 0, active: 0, paused: [], message: 'Collection stopped. Fetch again to retry missing details.' } }).catch(() => {});
        await diagnosticsLoaded;
        return { ok: true, diagnostics: diagnosticLog.snapshot() };
      }
      if (message.type === 'START') { await recordDiagnostic('START', 'started'); await start(message, sender); return { ok: true }; }
      if (message.type === 'STOP' && finished?.client === sender.tab.id && finished.payload.job === message.job) { finished = null; await chrome.storage.session.remove(RECEIPT); }
      if (!job || job.client !== sender.tab.id || job.id !== message.job) return {};
      if (message.type === 'ACK' && !Object.hasOwn(job.pending, message.packet)) return { ok: true };
      if (['STOP', 'ACK', 'RESUME', 'FOCUS'].includes(message.type)) await recordDiagnostic(message.type, 'started');
      if (message.type === 'STOP') { await cancel(); return { ok: true }; }
      if (message.type === 'ACK') { delete job.pending[message.packet]; await pump(); }
      if (message.type === 'PRIORITY') { job.priority = message.amount; await save(); }
      if (message.type === 'FOCUS' && job.tabs[message.tab]) { await chrome.tabs.update(message.tab, { active: true }); await chrome.windows.update(job.window, { focused: true }); }
      if (message.type === 'RESUME') {
        for (const [id, t] of Object.entries(job.tabs)) if (t.paused) {
          t.paused = ''; t.started = Date.now();
          // A stalled pagination reader retries the last page; allow one replay.
          if (t.kind === 'payments') t.signatures = [];
          try { await chrome.tabs.sendMessage(+id, { type: 'RESUME_PAGE', job: job.id }); } catch { await chrome.tabs.reload(+id); }
        }
        await pump();
      }
      return { ok: true };
    }
    if (!owned(sender)) return {};
    if (message.type === 'TASK') return { job: job.id, kind: job.tabs[sender.tab.id].kind };
    if (message.job !== job.id) return {};
    if (message.type === 'PAGE') { await page(message, sender); await recordDiagnostic('PAGE', 'ok'); }
    if (message.type === 'PAGE_ERROR') { await recordDiagnostic('PAGE_ERROR', 'paused'); job.tabs[sender.tab.id].paused = String(message.reason).slice(0, 200); await save(); await status(); }
    return { ok: true };
  }).then(reply).catch(async error => { await recordDiagnostic(message?.type, 'error', error); reply({ error: 'Amazon collection could not continue. Stop and retry.', ...(client(sender) ? { diagnostics: diagnosticLog.snapshot() } : {}) }); });
  return true;
});
chrome.tabs.onRemoved.addListener((id, info) => { void serial(async () => {
  await loaded;
  if (finished?.client === id) { finished = null; await chrome.storage.session.remove(RECEIPT); }
  if (!job) return;
  if (job.client === id) { await cancel(); return; }
  if (job.parkedTab === id || (job.tabs[id] && info?.isWindowClosing)) { await emit({ type: 'STATUS', running: false, pages: job.pages, orders: job.completed, queued: 0, active: 0, paused: [], message: 'Amazon window closed. Fetch again to retry missing details.' }); await cancel(); return; }
  if (job.tabs[id]) { delete job.tabs[id]; job.notice = 'A collection tab was closed. Some details may be missing; fetch again to retry.'; await pump(); }
}).catch(error => recordDiagnostic('TAB_REMOVED', 'error', error)); });
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'trilly-amazon') void serial(async () => {
  await loaded; if (!job) return;
  for (const task of Object.values(job.tabs)) if (!task.paused && !task.next && Date.now() - task.started > 90000) task.paused = 'Amazon took too long to respond. Resume to retry.';
  for (const [id, records] of Object.entries(job.pending)) await emit({ type: 'DATA', packet: id, ...records });
  await pump();
}).catch(error => recordDiagnostic('ALARM', 'error', error)); });
