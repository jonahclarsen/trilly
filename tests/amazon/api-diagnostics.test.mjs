import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

test('non-JSON API failures retain HTTP status without recording response bodies', async () => {
  // No listening socket or browser; all responses and storage are synthetic.
  const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom' });
  const originalFetch = globalThis.fetch;
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { getItem: () => null, setItem: () => {} } });
  try {
    const { api } = await server.ssrLoadModule('/src/lib/api.ts');
    const { diagnosticsReport } = await server.ssrLoadModule('/src/lib/diagnostics.ts');
    for (const [status, code] of [[413, 'payload_too_large'], [502, 'unknown'], [200, 'invalid_response']]) {
      globalThis.fetch = async () => new Response('synthetic-private-error-body', { status });
      await assert.rejects(api('amazon', { orders: [], payments: [] }), error => error.status === status);
      const report = JSON.parse(diagnosticsReport('1.0.8'));
      assert.equal(report.app.at(-1).http_status, status);
      assert.equal(report.app.at(-1).code, code);
      assert.doesNotMatch(JSON.stringify(report), /synthetic-private-error-body/);
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (descriptor) Object.defineProperty(globalThis, 'sessionStorage', descriptor);
    else delete globalThis.sessionStorage;
    await server.close();
  }
});
