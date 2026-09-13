// Match printed numbers and physical number keys across layouts and Num Lock states.
export function suggestionIndex(event: KeyboardEvent): number | undefined {
  const digit = /^[1-3]$/.test(event.key) ? event.key : /^(?:Digit|Numpad)([1-3])$/.exec(event.code)?.[1]
  return digit ? Number(digit) - 1 : undefined
}

export const merchantLinkKey = 'F'
export const googlePayeeKey = 'G'

export const shortcuts = [
  [merchantLinkKey, 'Open first merchant link in a new tab'],
  ['Alt+T', 'Transaction view'], ['Alt+V', 'List view'], ['Alt+R', 'Sync'], ['Alt+U', 'Undo'],
  ['Alt+B', 'Business expenses'], ['Alt+H', 'Help'], ['Alt+S', 'Settings'], ['Alt+L', 'Lock'],
  ['Enter', 'Approve / save description or expense'], ['1 / 2 / 3', 'Use suggestion & approve'],
  ['C', 'Choose category'], ['E', 'Choose payee'], ['S', 'Skip'], ['⌘Z / Ctrl+Z / U', 'Undo skip / approval / expense change'],
  [googlePayeeKey, 'Search payee on Google'],
  ['D', 'Edit transaction description'], ['B', 'Add business expense'], ['A', 'Choose account'], ['R', 'Sync'], [',', 'Settings'], ['L', 'Lock'], ['?', 'Help & shortcuts'],
] as const

export const menuKeys = { transaction: 'T', list: 'V', sync: 'R', undo: 'U', business: 'B', help: 'H', settings: 'S', lock: 'L' } as const
export function altShortcutLabel(key: string) {
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent)
  return `${mac ? '⌥' : 'Alt+'}${key}`
}
