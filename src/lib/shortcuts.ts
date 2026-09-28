// Match printed numbers and physical number keys across layouts and Num Lock states.
export function suggestionIndex(event: KeyboardEvent, count = 3): number | undefined {
  const digit = /^[1-9]$/.test(event.key) ? event.key : /^(?:Digit|Numpad)([1-9])$/.exec(event.code)?.[1]
  const index = digit ? Number(digit) - 1 : -1
  return index >= 0 && index < count ? index : undefined
}

export const pickerQuickCount = 4
function isMac() {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent)
}
export function pickerQuickIndex(event: KeyboardEvent): number | undefined {
  if (event.altKey || event.shiftKey || !(isMac() ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey)) return undefined
  return suggestionIndex(event, pickerQuickCount)
}
export function modShortcutLabel(key: string) {
  return `${isMac() ? '⌘' : 'Ctrl+'}${key}`
}
export function pickerQuickLabel(index: number) {
  return modShortcutLabel(String(index + 1))
}

export const merchantLinkKey = 'F'
export const ynabAccountKey = merchantLinkKey
export const googlePayeeKey = 'G'
export const mailSearchKey = 'M'
export const calendarWeekKey = 'K'
export const amazonOrderKey = 'A'
export const paypalActivityKey = 'P'
export const viewKeys = { transaction: 'T', list: 'V' } as const

export const shortcuts = [
  [merchantLinkKey, 'Open first merchant link / account in YNAB (list view)'],
  [viewKeys.transaction, 'Transaction view'], [viewKeys.list, 'List view'],
  ['Alt+R', 'Sync'], ['Alt+U', 'Undo'],
  ['Alt+B', 'Business expenses'], ['Alt+H', 'Help'], ['Alt+S', 'Settings'],
  ['Enter', 'Approve / save description or expense'], ['1 / 2 / 3', 'Use suggestion & approve'],
  ['C', 'Choose category'], ['E', 'Choose payee'], ['⌘1–4 / Ctrl+1–4', 'Pick top category or payee result'], ['S', 'Skip'], ['⌘Z / Ctrl+Z / U', 'Undo skip / approval / expense change'],
  [googlePayeeKey, 'Search original bank payee on Google'],
  [mailSearchKey, 'Search payee in mail'],
  [calendarWeekKey, 'Open calendar on transaction date'],
  [amazonOrderKey, 'Open Amazon order when available'],
  [paypalActivityKey, 'Open PayPal activity for PayPal transactions'],
  ['⌘C / Ctrl+C', 'Copy business expenses to sheet (no text selected)'], ['Alt+A', 'Show archived / current business expenses'],
  ['D', 'Edit transaction description'], ['B', 'Add business expense'], ['R', 'Sync'], [',', 'Settings'], ['?', 'Help & shortcuts'],
] as const

export const businessKeys = { copy: 'C', archived: 'A' } as const
export const menuKeys = { sync: 'R', undo: 'U', business: 'B', help: 'H', settings: 'S' } as const
export function altShortcutLabel(key: string) {
  return `${isMac() ? '⌥' : 'Alt+'}${key}`
}
