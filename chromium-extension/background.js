importScripts('parser.js');
const ORIGIN = 'http://127.0.0.1:28753';
const KEY = 'trillyAmazonJob';
const ORDER_LIMIT = 6;
const TAB_LIMIT = 12;
let chain = Promise.resolve();
const serial = fn => { const next = chain.then(fn); chain = next.catch(() => {}); return next; };
let job;
const loaded = chrome.storage.session.get(KEY).then(result => { job = result[KEY] || null; });
const save = () => job ? chrome.storage.session.set({ [KEY]: job }) : chrome.storage.session.remove(KEY);
function client(sender) { try { return sender.frameId === 0 && new URL(sender.url).origin === ORIGIN; } catch { return false; } }
function owned(sender) { return job && sender.frameId === 0 && job.tabs[String(sender.tab?.id)] && globalThis.TrillyAmazonParser.market(sender.url) === job.tabs[String(sender.tab.id)].marketplace; }
async function emit(payload) {
  if (!job) return;
  try { await chrome.tabs.sendMessage(job.client, { source: 'trilly-amazon-worker', payload: { ...payload, job: job.id } }); }
  catch { await cancel(); }
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
  const tabs = Object.keys(job.tabs).map(Number); job = null; await save(); await chrome.alarms.clear('trilly-amazon');
  await Promise.all(tabs.map(id => chrome.tabs.remove(id).catch(() => {})));
}
function urlFor(marketplace, id) { return `https://www.${marketplace}/gp/your-account/order-details?orderID=${id}`; }
function priority(entry) {
  return entry.amounts?.some(amount => amount === job.priority) ? 0 : 1;
}
async function createTab(task, url) {
  if (!job || Object.keys(job.tabs).length >= TAB_LIMIT) return;
  // Create blank first, register ownership, THEN navigate to avoid a TASK race.
  const tab = await chrome.tabs.create({ windowId: job.window, url: 'about:blank', active: false });
  job.tabs[tab.id] = { ...task, started: Date.now() }; await save();
  await chrome.tabs.update(tab.id, { url });
}
async function pump() {
  if (!job) return;
  if (Object.keys(job.pending).length < 12) {
    job.queue.sort((a, b) => priority(a) - priority(b));
    while (job.queue.length && Object.values(job.tabs).filter(t => t.kind === 'order').length < ORDER_LIMIT && Object.keys(job.tabs).length < TAB_LIMIT) {
      const next = job.queue.shift();
      await createTab({ kind: 'order', marketplace: next.marketplace, order: next.id }, urlFor(next.marketplace, next.id));
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
    await emit({ type: 'STATUS', running: false, pages: job.pages, orders: job.completed, queued: 0, active: 0, paused: [], message: job.notice || 'Amazon collection complete.' });
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
  const window = await chrome.windows.create({ url: 'about:blank', focused: false, type: 'normal' });
  job = { id: message.job, client: sender.tab.id, window: window.id, oldest: message.oldest, priority: message.priority,
    queue: [], seen: [], tabs: {}, pending: {}, pages: 0, completed: 0, notice: '',
    cached: Array.isArray(message.cached) ? message.cached.slice(0, 5000) : [] };
  // Reuse the new window's blank tab for the first payments reader.
  const first = window.tabs[0].id;
  job.tabs[first] = { kind: 'payments', marketplace: 'amazon.ca', started: Date.now(), signatures: [], pages: 0 }; await save();
  await chrome.tabs.update(first, { url: 'https://www.amazon.ca/cpe/yourpayments/transactions' });
  await createTab({ kind: 'payments', marketplace: 'amazon.com', signatures: [], pages: 0 }, 'https://www.amazon.com/cpe/yourpayments/transactions');
  await chrome.alarms.create('trilly-amazon', { periodInMinutes: 0.5 }); await status();
}
async function page(message, sender) {
  if (!owned(sender) || message.job !== job.id) return;
  const tabId = sender.tab.id, task = job.tabs[tabId];
  if (task.paused) return;
  if (task.kind === 'payments') {
    if (!Array.isArray(message.payments) || message.payments.length > 100 || message.payments.some(p => p.marketplace !== task.marketplace)) throw new Error('Invalid payment page');
    const signature = message.payments.map(p => p.id).join('|');
    if (task.signatures.includes(signature)) { task.paused = 'Payments page repeated. Check pagination, then resume.'; await save(); await status(); return; }
    task.signatures.push(signature); task.pages++; job.pages++;
    const cutoff = new Date(job.oldest + 'T00:00:00Z').getTime() - 14 * 86400000;
    const allOlder = message.payments.length > 0 && message.payments.every(p => p.date && new Date(p.date + 'T00:00:00Z').getTime() < cutoff);
    for (const payment of message.payments) {
      if (payment.date && new Date(payment.date + 'T00:00:00Z').getTime() < cutoff) continue;
      for (const id of payment.order_ids || []) {
        if (!/^\d{3}-\d{7}-\d{7}$/.test(id)) continue;
        const key = `${task.marketplace}:${id}`;
        if (job.seen.includes(key)) continue;
        const cached = job.cached.find(c => c.key === key);
        // Refunds always refresh the order. Other orders refresh after 24 hours.
        if (cached && !payment.refund && Date.now() - Date.parse(cached.at) < 86400000) continue;
        if (job.seen.length >= 5000) { job.notice = 'Order limit reached. Some older details may be missing.'; continue; }
        job.seen.push(key);
        job.queue.push({ id, marketplace: task.marketplace, amounts: message.payments.filter(p => p.order_ids.includes(id)).map(p => p.amount) });
      }
    }
    await packet({ payments: message.payments, orders: [] }); if (!job) return;
    if (message.hasNext && !allOlder && task.pages < 100) task.next = true;
    else { if (task.pages >= 100) job.notice = 'Stopped after 100 pages per marketplace. Older history may be incomplete.'; delete job.tabs[tabId]; await chrome.tabs.remove(tabId).catch(() => {}); }
  } else {
    if (message.order?.id !== task.order || message.order.marketplace !== task.marketplace) throw new Error('Order page does not match requested order');
    await packet({ payments: [], orders: [message.order] }); if (!job) return;
    job.completed++; delete job.tabs[tabId]; await chrome.tabs.remove(tabId).catch(() => {});
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
    await loaded;
    if (client(sender)) {
      if (message.type === 'PING') {
        if (job?.client === sender.tab.id) { await status(); for (const [id, records] of Object.entries(job?.pending || {})) await emit({ type: 'DATA', packet: id, ...records }); }
        return { ok: true };
      }
      if (message.type === 'START') { await start(message, sender); return { ok: true }; }
      if (!job || job.client !== sender.tab.id || job.id !== message.job) return {};
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
    if (message.type === 'PAGE') await page(message, sender);
    if (message.type === 'PAGE_ERROR') { job.tabs[sender.tab.id].paused = String(message.reason).slice(0, 200); await save(); await status(); }
    return { ok: true };
  }).then(reply).catch(async () => { reply({ error: 'Amazon collection could not continue. Stop and retry.' }); });
  return true;
});
chrome.tabs.onRemoved.addListener((id, info) => { void serial(async () => {
  await loaded; if (!job) return;
  if (job.client === id) { await cancel(); return; }
  if (job.tabs[id] && info?.isWindowClosing) { await emit({ type: 'STATUS', running: false, pages: job.pages, orders: job.completed, queued: 0, active: 0, paused: [], message: 'Amazon window closed. Fetch again to retry missing details.' }); await cancel(); return; }
  if (job.tabs[id]) { delete job.tabs[id]; job.notice = 'A collection tab was closed. Some details may be missing; fetch again to retry.'; await pump(); }
}); });
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'trilly-amazon') void serial(async () => {
  await loaded; if (!job) return;
  for (const task of Object.values(job.tabs)) if (!task.paused && !task.next && Date.now() - task.started > 90000) task.paused = 'Amazon took too long to respond. Resume to retry.';
  for (const [id, records] of Object.entries(job.pending)) await emit({ type: 'DATA', packet: id, ...records });
  await pump();
}); });
