// @ts-nocheck
// Shared by the extension, HTML-paste fallback, and synthetic DOM tests.
// Never return raw HTML, scripts, hidden inputs, addresses, or account credentials.
(() => {
  const text = node => {
    const copy = node?.cloneNode(true);
    copy?.querySelectorAll?.('script, style, template, noscript, input, textarea, [hidden]').forEach(el => el.remove());
    return (copy?.textContent || '').replace(/\s+/g, ' ').trim();
  };
  const field = (node, name) => node.querySelector(`[data-component="${name}"]`);
  function market(value) {
    try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.port && /^(www\.)?amazon\.(ca|com)$/.test(u.hostname) ? u.hostname.replace(/^www\./, '') : null; } catch { return null; }
  }
  function safeURL(value, base) {
    if (!value) return '';
    try { const u = new URL(value, base); return market(u.href) === market(base) ? u.href : ''; } catch { return ''; }
  }
  function money(value) {
    const m = String(value).replace(/\u00a0/g, ' ').match(/(?:^|[^\d])([+-]?)\s*(?:(?:CA|US|C|CDN)?\$|CAD|USD)?\s*(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})(?!\d)/i);
    return m ? (Number(m[2].replaceAll(',', '')) * 1000 + Number(m[3]) * 10) * (m[1] === '-' ? -1 : 1) : null;
  }
  function currency(value, marketplace) {
    if (/US\$|\bUSD\b/i.test(value)) return 'USD';
    if (/(?:CA|CDN|C)\$|\bCAD\b/i.test(value)) return 'CAD';
    return marketplace === 'amazon.ca' ? 'CAD' : 'USD';
  }
  function date(value) {
    const months = 'january february march april may june july august september october november december'.split(' ');
    const s = String(value).toLowerCase().replace(/\./g, '');
    let m = s.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
    if (m) return validDate(+m[1], +m[2], +m[3]);
    m = s.match(/\b([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?[,]?\s+(20\d{2})\b/);
    if (m) return validDate(+m[3], months.findIndex(n => n.startsWith(m[1])) + 1, +m[2]);
    m = s.match(/\b(\d{1,2})\s+([a-z]+)[,]?\s+(20\d{2})\b/);
    return m ? validDate(+m[3], months.findIndex(n => n.startsWith(m[2])) + 1, +m[1]) : '';
  }
  function validDate(y, m, d) {
    const value = new Date(Date.UTC(y, m - 1, d));
    return m > 0 && value.getUTCMonth() === m - 1 && value.getUTCDate() === d ? value.toISOString().slice(0, 10) : '';
  }
  function dateAt(node) {
    const own = date(text(node)); if (own) return own;
    for (let parent = node, depth = 0; parent && depth < 5; parent = parent.parentElement, depth++) {
      for (let prev = parent.previousElementSibling, n = 0; prev && n < 200; prev = prev.previousElementSibling, n++) {
        const found = date(text(prev)); if (found) return found;
      }
    }
    return '';
  }
  function orderId(value) { return String(value).match(/\b\d{3}-\d{7}-\d{7}\b/)?.[0] || ''; }
  function hash(value) {
    let h = 2166136261; for (const c of value) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return (h >>> 0).toString(16);
  }
  function payments(doc, url) {
    const marketplace = market(url); if (!marketplace) throw new Error('Unsupported Amazon marketplace');
    const occurrences = new Map();
    const rows = [...doc.querySelectorAll('.apx-transactions-line-item-component-container')];
    const records = rows.flatMap(container => {
      const amountText = text(container.querySelector('.a-size-base-plus.a-text-bold'));
      const amount = money(amountText); if (amount === null || !amount) return [];
      const evidence = text(container).slice(0, 2000);
      const links = [...container.querySelectorAll('a[href*="orderID"], a[href*="orderId"], a[href*="order-id"]')];
      const order_ids = [...new Set(links.map(a => orderId(a.getAttribute('href'))).filter(Boolean))];
      const refund = /\b(refund(?:ed)?|credit(?:ed)?|reimbursement)\b/i.test(evidence) || /\+/.test(amountText);
      const payment_date = dateAt(container);
      const payment_method = evidence.match(/(?:visa|mastercard|master card|amex|american express|discover)[^.]*?(?:\*+|ending\s+(?:in\s+)?|•+|·+)\s*\d{4}/i)?.[0] || '';
      const fingerprint = `${marketplace}|${payment_date}|${amountText}|${order_ids.join(',')}|${evidence}`;
      const occurrence = occurrences.get(fingerprint) || 0; occurrences.set(fingerprint, occurrence + 1);
      return [{ id: `${marketplace}:${hash(fingerprint)}:${occurrence}`, marketplace, date: payment_date,
        amount: Math.abs(amount) * (refund ? 1 : -1), currency: currency(amountText, marketplace), refund,
        payment_method, order_ids, evidence }];
    });
    const nextControl = [...doc.querySelectorAll('a, button, input, [role=button], .a-button')].find(el =>
      [text(el), el.getAttribute('aria-label'), el.getAttribute('value'), el.getAttribute('title')].some(label => /^(next(?: page)?|older(?: transactions)?|suivant)\s*[›»→]?$/i.test(label || '')) &&
      !el.disabled && el.getAttribute('aria-disabled') !== 'true' && !el.closest('.a-disabled, .a-button-disabled'));
    const next = nextControl?.querySelector('input, button, a') || nextControl;
    return { payments: records, rowCount: rows.length, next: next || null };
  }
  function order(doc, url) {
    const marketplace = market(url); if (!marketplace) throw new Error('Unsupported Amazon marketplace');
    const id = orderId(url) || orderId(text(field(doc, 'orderId'))) || orderId(doc.querySelector('[data-component=orderInvoice] a[href]')?.getAttribute('href') || '');
    if (!id) return null;
    const titleNodes = [...doc.querySelectorAll('[data-component="itemTitle"]')];
    const items = titleNodes.map((titleNode, index) => {
      const row = titleNode.closest('.a-fixed-left-grid') || titleNode.parentElement;
      const anchor = titleNode.querySelector('a');
      const quantityText = text(field(row, 'quantity')) || text(row.querySelector('.od-item-view-qty'));
      const quantity = Number(quantityText.match(/\d+/)?.[0] || 1);
      const priceText = text(field(row, 'unitPrice')?.querySelector('.a-offscreen')) || text(field(row, 'unitPrice'));
      const shipment = row.closest('[data-component="shipmentsLeftGrid"]') || row.closest('.a-box-inner');
      const imageNode = field(row, 'itemImage')?.querySelector('img');
      let product_url = safeURL(anchor?.getAttribute('href') || '', url);
      if (product_url) { const u = new URL(product_url); u.search = ''; u.hash = ''; product_url = u.href; }
      return { id: `${id}:${index}`, title: text(titleNode).slice(0, 1000), quantity,
        unit_price: money(priceText), price_text: priceText.slice(0, 100), product_url,
        image: '', image_url: imageNode?.getAttribute('src') || '',
        seller: text(field(row, 'orderedMerchant')).slice(0, 300),
        status: text(field(shipment || row, 'shipmentStatus')).slice(0, 600),
        details: ['itemCondition', 'itemReturnEligibility', 'purchasedVariationDetails', 'deliveryFrequency', 'substitutionDetails', 'customizedItemDetails']
          .map(name => text(field(row, name))).filter(Boolean).join(' · ').slice(0, 1200) };
    }).filter(item => item.title);
    if (!items.length) return null;
    const totals = [...doc.querySelectorAll('.od-line-item-row')].map(row => ({
      label: text(row.querySelector('.od-line-item-row-label')).slice(0, 150),
      value: text(row.querySelector('.od-line-item-row-content')).slice(0, 150),
    })).filter(row => row.label && row.value);
    const totalText = totals.find(row => /grand total|order total/i.test(row.label))?.value || '';
    return { id, marketplace, url: `https://www.${marketplace}/gp/your-account/order-details?orderID=${id}`,
      date: date(text(field(doc, 'orderDate'))), currency: currency(totalText, marketplace),
      total: money(totalText), payment_method: text(doc.querySelector('[data-testid="payment-instrument-name"]')).slice(0, 200),
      items, totals, fetched_at: new Date().toISOString() };
  }
  globalThis.TrillyAmazonParser = { text, market, safeURL, money, currency, date, orderId, payments, order };
})();
