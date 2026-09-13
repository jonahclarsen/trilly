import '../../chromium-extension/diagnostics.js'

type Event = { at: number; operation: string; outcome: string; code?: string; [key: string]: unknown }
const diagnostics = (globalThis as unknown as { TrillyDiagnostics: {
  create: (initial?: unknown) => { snapshot: () => Event[]; record: (operation: string, outcome: string, error?: unknown, counts?: Record<string, number>) => void }
  clean: (events: unknown) => Event[]
} }).TrillyDiagnostics
const storageSlot = 'trilly-diagnostics-v1'
let initial: unknown = []
try { initial = JSON.parse(sessionStorage.getItem(storageSlot) ?? '[]') } catch { /* Storage can be unavailable. */ }
const app = diagnostics.create(initial)
let extension: Event[] | null = null
let receivedAt: number | null = null
let installedVersion = 'unavailable'
export function recordDiagnostic(operation: string, outcome: string, error?: unknown, counts?: Record<string, number>) {
  app.record(operation, outcome, error, counts)
  try { sessionStorage.setItem(storageSlot, JSON.stringify(app.snapshot())) } catch { /* Diagnostics must not interrupt work. */ }
}
export function receiveDiagnostics(events: unknown) {
  extension = diagnostics.clean(events); receivedAt = Date.now()
}
export function diagnosticVersion(value: unknown) {
  installedVersion = typeof value === 'string' && /^\d{1,5}(?:\.\d{1,5}){1,3}$/.test(value) ? value : 'unavailable'
}
export function diagnosticsReport(expectedVersion: string) {
  return JSON.stringify({ format: 'trilly-diagnostics-v1', generated_at: new Date().toISOString(),
    expected_extension: expectedVersion, installed_extension: installedVersion,
    extension_received_at: receivedAt, app: app.snapshot(), extension: extension === null ? 'unavailable' : diagnostics.clean(extension),
  }, null, 2)
}
