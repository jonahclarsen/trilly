import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../../chromium-extension/diagnostics.js', import.meta.url), 'utf8');
function core() { const context = vm.createContext({ Date }); vm.runInContext(source, context); return context.TrillyDiagnostics; }

test('diagnostics retain useful failure metadata without private exception details', () => {
  const d = core().create();
  d.record('ACK', 'error', { name: 'TypeError', message: 'synthetic-secret-order https://amazon.ca/private',
    stack: 'TypeError: synthetic-secret-token\n at secretFunction (chrome-extension://private-id/background.js:123:45)\n at https://amazon.ca/private:12:34' },
    { pages: 3, orders: 8, token: 'synthetic-secret', amount: 12345, url: 'https://amazon.ca/private' });
  const events = JSON.parse(JSON.stringify(d.snapshot()));
  assert.equal(events[0].code, 'type_error');
  assert.deepEqual(events[0].locations, ['background.js:123:45']);
  assert.equal(events[0].orders, 8);
  assert.doesNotMatch(JSON.stringify(events), /synthetic|amazon|private|secretFunction|token|amount|https/);
});

test('reports allowlist imported fields and cap event count, age and size', () => {
  const api = core();
  const events = Array.from({ length: 1000 }, () => ({ at: Date.now(), operation: 'PAGE', outcome: 'ok', orders: 3, raw: 'secret'.repeat(1000), locations: ['https://private.example:123:4'] }));
  const d = api.create(events);
  assert.equal(d.snapshot().length, 80);
  assert.ok(JSON.stringify(d.snapshot()).length < 16000);
  d.record('secret-operation', 'error', new Error('secret'));
  assert.equal(d.snapshot().length, 80);
  assert.equal(api.clean([{ at: Date.now() - 86400001, operation: 'PAGE', outcome: 'ok' }]).length, 0);
  assert.equal(api.clean([{ at: Date.now(), operation: 'PAGE', outcome: 'ok', pages: 'secret' }])[0].pages, undefined);
});

test('browser failures are classified without copying their messages', () => {
  for (const [message, code] of [
    ['No window with id: 123', 'window_missing'], ['No tab with id: 123', 'tab_missing'],
    ['QUOTA_BYTES quota exceeded with private data', 'storage_quota'],
    ['Could not establish connection. Receiving end does not exist.', 'connection_closed'],
  ]) {
    const d = core().create(); d.record('START', 'error', { message });
    assert.equal(d.snapshot()[0].code, code);
    assert.ok(!JSON.stringify(d.snapshot()).includes(message));
  }
});

test('app report combines sanitized worker and API diagnostics using synthetic session storage', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  const values = new Map();
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
    getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value),
  } });
  try {
    const app = await import('../../src/lib/diagnostics.ts');
    assert.equal(JSON.parse(app.diagnosticsReport('1.2.3')).extension, 'unavailable');
    app.recordDiagnostic('IMPORT', 'error', { status: 401, message: 'synthetic-private-token' }, { http_status: 401 });
    app.diagnosticVersion('1.2.3');
    app.receiveDiagnostics([{ at: Date.now(), operation: 'ACK', outcome: 'error', code: 'type_error', token: 'synthetic-private-token' }]);
    const report = JSON.parse(app.diagnosticsReport('1.2.3'));
    assert.equal(report.installed_extension, '1.2.3');
    assert.equal(report.app.at(-1).code, 'authorization');
    assert.equal(report.extension.at(-1).operation, 'ACK');
    assert.doesNotMatch(JSON.stringify(report), /synthetic-private-token/);
    assert.doesNotMatch([...values.values()].join(''), /synthetic-private-token/);
    app.diagnosticVersion('synthetic-private-token');
    assert.equal(JSON.parse(app.diagnosticsReport('1.2.3')).installed_extension, 'unavailable');
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'sessionStorage', descriptor);
    else delete globalThis.sessionStorage;
  }
});
