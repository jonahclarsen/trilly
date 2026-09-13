import { recordDiagnostic } from './diagnostics'
// HMR keeps only this module's in-memory credential, never browser storage.
let session: string = import.meta.hot?.data.session ?? ''
let autoUnlock: boolean = import.meta.hot?.data.autoUnlock ?? true
export function setSession(value: string) {
  session = value; autoUnlock = false
  if (import.meta.hot) { import.meta.hot.data.session = value; import.meta.hot.data.autoUnlock = false }
}
export function hasSession() { return session !== '' }
export function shouldAutoUnlock() { return autoUnlock }
if (import.meta.hot) import.meta.hot.dispose(data => { data.session = session; data.autoUnlock = autoUnlock })
export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message) }
}
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const action = body as { clear?: boolean; action?: string } | undefined
  const operation = path === 'amazon' ? (action?.clear ? 'CLEAR' : body === undefined ? 'LOAD' : 'IMPORT') : path === 'action' && action?.action === 'sync' ? 'SYNC' : null
  try {
    const response = await fetch(`/api/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', 'x-trilly': '1', ...(session ? { 'x-session': session } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store', credentials: 'omit',
    })
    const result = await response.json()
    if (!response.ok) throw new ApiError(result.error ?? 'Request failed', response.status)
    if (operation) recordDiagnostic(operation, result.sync_error ? 'error' : 'ok', result.sync_error ? new Error(String(result.sync_error)) : undefined, { http_status: response.status })
    return result
  } catch (error) {
    if (operation) recordDiagnostic(operation, 'error', error, error instanceof ApiError ? { http_status: error.status } : {})
    throw error
  }
}
