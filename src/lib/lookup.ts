// One provider drives both mail and calendar lookups; persisted like the logo.
export type LookupProvider = 'google' | 'proton'
export const DEFAULT_LOOKUP: LookupProvider = 'google'
export const LOOKUP_PROVIDERS: { id: LookupProvider; name: string; mail: string; calendar: string }[] = [
  { id: 'google', name: 'Google', mail: 'Gmail', calendar: 'Google Calendar' },
  { id: 'proton', name: 'Proton', mail: 'Proton Mail', calendar: 'Proton Calendar' },
]

export function readLookup(): LookupProvider {
  try {
    const value = JSON.parse(localStorage.getItem('lookup') ?? '{}')
    // Earlier versions stored separate mail and calendar choices.
    const provider = value?.provider ?? (value?.mail === 'proton' || value?.calendar === 'proton' ? 'proton' : undefined)
    return LOOKUP_PROVIDERS.some(p => p.id === provider) ? provider : DEFAULT_LOOKUP
  } catch { return DEFAULT_LOOKUP }
}
export function saveLookup(provider: LookupProvider) {
  try { localStorage.setItem('lookup', JSON.stringify({ provider })) } catch { /* Storage may be disabled. */ }
}

export const googleSearchUrl = (query: string) => `https://www.google.com/search?q=${encodeURIComponent(query)}`
export function mailSearchUrl(provider: LookupProvider, query: string) {
  const q = encodeURIComponent(query.trim())
  return provider === 'proton' ? `https://mail.proton.me/u/13/almost-all-mail#keyword=${q}` : `https://mail.google.com/mail/u/0/#search/${q}`
}
// Opens the week containing an ISO transaction date.
export function calendarWeekUrl(provider: LookupProvider, date: string) {
  const [year, month, day] = date.split('-').map(Number)
  const path = `week/${year}/${month}/${day}`
  return provider === 'proton' ? `https://calendar.proton.me/u/13/${path}` : `https://calendar.google.com/calendar/r/${path}`
}
