export function amazonCommand(type: string, fields: Record<string, unknown> = {}) {
  window.postMessage({ source: 'trilly-amazon-app', type, ...fields }, location.origin)
}
export function listenAmazon(receive: (message: Record<string, any>) => void) {
  const handler = (event: MessageEvent) => {
    if (event.source === window && event.origin === location.origin && event.data?.source === 'trilly-amazon-extension') receive(event.data)
  }
  window.addEventListener('message', handler)
  amazonCommand('PING')
  return () => window.removeEventListener('message', handler)
}
