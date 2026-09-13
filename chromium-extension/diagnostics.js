(() => {
  // Allowlisted metadata only. Never retain exception text, raw stacks, URLs,
  // identifiers, page contents, transaction records, or credentials.
  const operations = new Set(['START', 'STOP', 'PAGE', 'ACK', 'RESUME', 'FOCUS', 'PING', 'PRIORITY', 'TASK', 'ALARM', 'TAB_REMOVED', 'DELIVERY', 'STORAGE', 'IMPORT', 'CLEAR', 'COMPLETE', 'BRIDGE', 'PAGE_ERROR', 'LOAD', 'SYNC']);
  const outcomes = new Set(['ok', 'error', 'paused', 'complete', 'started', 'partial']);
  const codes = new Set(['unknown', 'type_error', 'reference_error', 'storage_quota', 'tab_missing', 'window_missing', 'connection_closed', 'extension_unavailable', 'invalid_records', 'network', 'authorization', 'timeout']);
  /** @param {any} error */
  function classify(error) {
    const message = String(error?.message ?? '').slice(0, 2000);
    if (/quota|MAX_WRITE|storage.*exceed/i.test(message)) return 'storage_quota';
    if (/no tab|tab.*(?:closed|not found)|invalid tab/i.test(message)) return 'tab_missing';
    if (/no window|window.*(?:closed|not found)|invalid window/i.test(message)) return 'window_missing';
    if (/receiving end|message port|connection.*closed/i.test(message)) return 'connection_closed';
    if (/context invalidated/i.test(message)) return 'extension_unavailable';
    if (/invalid|does not match/i.test(message)) return 'invalid_records';
    if (error?.status === 401 || error?.status === 403) return 'authorization';
    if (/fetch|network/i.test(message)) return 'network';
    if (error?.name === 'TimeoutError') return 'timeout';
    if (error?.name === 'TypeError') return 'type_error';
    if (error?.name === 'ReferenceError') return 'reference_error';
    return 'unknown';
  }
  /** @param {any} event */
  function sanitize(event) {
    if (!event || !operations.has(event.operation) || !outcomes.has(event.outcome) || !Number.isSafeInteger(event.at) || event.at > Date.now() + 60000 || event.at < Date.now() - 86400000) return null;
    /** @type {Record<string, any>} */
    const clean = { at: event.at, operation: event.operation, outcome: event.outcome };
    if (codes.has(event.code)) clean.code = event.code;
    for (const key of ['pages', 'orders', 'queued', 'active', 'pending', 'paused', 'http_status']) {
      if (Number.isSafeInteger(event[key]) && event[key] >= 0 && event[key] <= 1000000) clean[key] = event[key];
    }
    if (Array.isArray(event.locations)) clean.locations = event.locations.filter(/** @param {unknown} p */ p => typeof p === 'string' && /^(?:background|collector|bridge|diagnostics)\.js:\d{1,6}:\d{1,6}$/.test(p)).slice(0, 5);
    return clean;
  }
  /** @param {unknown} events */
  function clean(events) { return (Array.isArray(events) ? events.slice(-80) : []).map(sanitize).filter(Boolean); }
  /** @param {unknown} initial */
  function create(initial = []) {
    let events = clean(initial);
    return {
      snapshot() { events = clean(events); return events.map(e => ({ ...e })); },
      /** @param {string} operation @param {string} outcome @param {any} [error] @param {Record<string, number>} [counts] */
      record(operation, outcome, error, counts = {}) {
        const locations = error ? [...String(error.stack ?? '').slice(0, 8000).matchAll(/\b(background|collector|bridge|diagnostics)\.js:(\d{1,6}):(\d{1,6})\b/g)].map(m => `${m[1]}.js:${m[2]}:${m[3]}`) : [];
        const event = sanitize({ ...counts, at: Date.now(), operation, outcome, ...(error ? { code: classify(error), locations } : {}) });
        if (event) events = clean([...events, event]);
      },
    };
  }
  /** @type {any} */ (globalThis).TrillyDiagnostics = { create, clean };
})();
