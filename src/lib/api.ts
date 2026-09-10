let session = ''
export function setSession(value: string) { session = value }
export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message) }
}
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', 'x-ynab-plus': '1', ...(session ? { 'x-session': session } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store', credentials: 'omit',
  })
  const result = await response.json()
  if (!response.ok) throw new ApiError(result.error ?? 'Request failed', response.status)
  return result
}
