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
export function pickerQuickLabel(index: number) {
  return `${isMac() ? '⌘' : 'Ctrl+'}${index + 1}`
}

export const merchantLinkKey = 'F'
export const googlePayeeKey = 'G'
export const amazonOrderKey = 'A'
export const paypalActivityKey = 'P'

export const shortcuts = [
  [merchantLinkKey, 'Open first merchant link in a new tab'],
  ['Alt+T', 'Transaction view'], ['Alt+V', 'List view'], ['Alt+R', 'Sync'], ['Alt+U', 'Undo'],
  ['Alt+B', 'Business expenses'], ['Alt+H', 'Help'], ['Alt+S', 'Settings'], ['Alt+L', 'Lock'],
  ['Enter', 'Approve / save description or expense'], ['1 / 2 / 3', 'Use suggestion & approve'],
  ['C', 'Choose category'], ['E', 'Choose payee'], ['⌘1–4 / Ctrl+1–4', 'Pick top category or payee result'], ['S', 'Skip'], ['⌘Z / Ctrl+Z / U', 'Undo skip / approval / expense change'],
  [googlePayeeKey, 'Search payee on Google'],
  [amazonOrderKey, 'Open Amazon order when available'],
  [paypalActivityKey, 'Open PayPal activity for PayPal transactions'],
  ['D', 'Edit transaction description'], ['B', 'Add business expense'], ['R', 'Sync'], [',', 'Settings'], ['L', 'Lock'], ['?', 'Help & shortcuts'],
] as const

export const menuKeys = { transaction: 'T', list: 'V', sync: 'R', undo: 'U', business: 'B', help: 'H', settings: 'S', lock: 'L' } as const
export function altShortcutLabel(key: string) {
  return `${isMac() ? '⌥' : 'Alt+'}${key}`
}
