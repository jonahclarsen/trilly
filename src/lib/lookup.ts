// Mail and calendar providers for payee lookups; persisted like the logo.
export type MailProvider = 'gmail' | 'proton'
export type CalendarProvider = 'google' | 'proton'
export type Lookup = { mail: MailProvider; calendar: CalendarProvider }
export const DEFAULT_LOOKUP: Lookup = { mail: 'gmail', calendar: 'google' }
export const MAIL_PROVIDERS: { id: MailProvider; name: string }[] = [{ id: 'gmail', name: 'Gmail' }, { id: 'proton', name: 'Proton Mail' }]
export const CALENDAR_PROVIDERS: { id: CalendarProvider; name: string }[] = [{ id: 'google', name: 'Google Calendar' }, { id: 'proton', name: 'Proton Calendar' }]

export function readLookup(): Lookup {
  try {
    const value = JSON.parse(localStorage.getItem('lookup') ?? '{}')
    return {
      mail: MAIL_PROVIDERS.some(p => p.id === value?.mail) ? value.mail : DEFAULT_LOOKUP.mail,
      calendar: CALENDAR_PROVIDERS.some(p => p.id === value?.calendar) ? value.calendar : DEFAULT_LOOKUP.calendar,
    }
  } catch { return { ...DEFAULT_LOOKUP } }
}
export function saveLookup(lookup: Lookup) {
  try { localStorage.setItem('lookup', JSON.stringify(lookup)) } catch { /* Storage may be disabled. */ }
}

export const googleSearchUrl = (query: string) => `https://www.google.com/search?q=${encodeURIComponent(query)}`
export function mailSearchUrl(provider: MailProvider, query: string) {
  const q = encodeURIComponent(query.trim())
  return provider === 'proton' ? `https://mail.proton.me/u/13/almost-all-mail#keyword=${q}` : `https://mail.google.com/mail/u/0/#search/${q}`
}
// Opens the week containing an ISO transaction date.
export function calendarWeekUrl(provider: CalendarProvider, date: string) {
  const [year, month, day] = date.split('-').map(Number)
  const path = `week/${year}/${month}/${day}`
  return provider === 'proton' ? `https://calendar.proton.me/u/13/${path}` : `https://calendar.google.com/calendar/r/${path}`
}
