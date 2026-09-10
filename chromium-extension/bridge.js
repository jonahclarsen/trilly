(() => {
  // Match patterns cannot restrict ports. Enforce the permanent Trilly origin here
  // AND in the worker; another localhost app cannot start or receive a collection.
  if (location.origin !== 'http://127.0.0.1:28753') return;
  const emit = message => window.postMessage({ source: 'trilly-amazon-extension', ...message }, location.origin);
  chrome.runtime.onMessage.addListener(message => { if (message?.source === 'trilly-amazon-worker') emit(message.payload); });
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.source !== 'trilly-amazon-app') return;
    if (!['PING', 'START', 'STOP', 'ACK', 'PRIORITY', 'RESUME', 'FOCUS'].includes(event.data.type)) return;
    chrome.runtime.sendMessage(event.data).then(response => {
      if (response?.error) emit({ type: 'ERROR', job: event.data.job, message: response.error });
      else if (event.data.type === 'PING') emit({ type: 'READY' });
    }).catch(() => emit({ type: 'ERROR', job: event.data.job, message: 'Reload Trilly after enabling the Amazon extension.' }));
  });
})();
