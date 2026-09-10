// Match printed numbers and physical number keys across layouts and Num Lock states.
export function suggestionIndex(event: KeyboardEvent): number | undefined {
  const digit = /^[1-3]$/.test(event.key) ? event.key : /^(?:Digit|Numpad)([1-3])$/.exec(event.code)?.[1]
  return digit ? Number(digit) - 1 : undefined
}

export const shortcuts = [
  ['Enter', 'Approve / save expense'], ['1 / 2 / 3', 'Use suggestion & approve'],
  ['C', 'Choose category'], ['P', 'Choose payee'], ['S', 'Skip'], ['⌘Z / Ctrl+Z / U', 'Undo expense change / approval'],
  ['B', 'Add business expense'], ['A', 'Choose account'], ['R', 'Sync'], [',', 'Settings'], ['L', 'Lock'], ['?', 'Help & shortcuts'],
] as const
