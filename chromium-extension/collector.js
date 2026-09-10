(() => {
  // Merely installed on other tabs: never inspect their DOM unless the worker
  // confirms this is one of the tabs it created for the user's active job.
  let task, timer, deadline, observer, last = '', previous = '', stable = 0, sent = false;
  const parser = globalThis.TrillyAmazonParser;
  function stop() { clearTimeout(timer); timer = undefined; observer?.disconnect(); }
  function schedule() { if (!timer) timer = setTimeout(read, 350); }
  async function read() {
    timer = undefined;
    if (!task || sent) return;
    if (document.querySelector('#ap_email, #ap_password, #captchacharacters, form[action*="validateCaptcha"]')) {
      sent = true; stop(); await chrome.runtime.sendMessage({ type: 'PAGE_ERROR', job: task.job, reason: 'Sign in or complete Amazon’s check, then resume.', login: true }); return;
    }
    const result = task.kind === 'payments' ? parser.payments(document, location.href) : parser.order(document, location.href);
    const ready = task.kind === 'payments' ? result.rowCount > 0 && result.payments.length > 0 : result?.items.length > 0 && result.totals.length > 0;
    if (ready) {
      const signature = JSON.stringify(task.kind === 'payments' ? result.payments : result);
      if (signature === previous && Date.now() < deadline) { schedule(); return; }
      if (signature !== last) { last = signature; stable = Date.now(); }
      if (Date.now() - stable >= 700) {
        sent = true; stop();
        if (task.kind === 'payments') {
          await chrome.runtime.sendMessage({ type: 'PAGE', job: task.job, signature: last, payments: result.payments, hasNext: !!result.next });
        } else {
          // Thumbnails are optional. Never fetch images from arbitrary HTML URLs.
          await Promise.all(result.items.slice(0, 8).map(async item => {
            if (!item.image_url) return;
            try { const reply = await chrome.runtime.sendMessage({ type: 'IMAGE', job: task.job, url: item.image_url }); item.image = reply?.image || ''; } catch {}
          }));
          for (const item of result.items) delete item.image_url;
          await chrome.runtime.sendMessage({ type: 'PAGE', job: task.job, order: result });
        }
        return;
      }
    }
    if (Date.now() > deadline) {
      sent = true; stop();
      await chrome.runtime.sendMessage({ type: 'PAGE_ERROR', job: task.job, reason: 'Amazon details were not recognized. Check the page, then resume or use HTML paste.', login: false });
      return;
    }
    schedule();
  }
  function begin(value) {
    task = value; sent = false; last = ''; stable = 0; deadline = Date.now() + 60000;
    stop(); observer = new MutationObserver(schedule); observer.observe(document, { childList: true, subtree: true }); schedule();
  }
  chrome.runtime.onMessage.addListener((message, _sender, reply) => {
    if (message.type === 'CANCEL') { task = null; stop(); reply({ ok: true }); }
    if (message.type === 'NEXT' && task?.job === message.job) {
      const next = parser.payments(document, location.href).next;
      if (!next) { reply({ error: 'Next payments page unavailable' }); return; }
      // For normal navigation a fresh content script starts; this also supports
      // Amazon's in-place payment pagination without waiting for window.load.
      previous = last; begin(task); next.click(); reply({ ok: true });
    }
    if (message.type === 'RESUME_PAGE' && task?.job === message.job) { begin(task); reply({ ok: true }); }
  });
  chrome.runtime.sendMessage({ type: 'TASK' }).then(value => { if (value?.job) begin(value); }).catch(() => {});
})();
