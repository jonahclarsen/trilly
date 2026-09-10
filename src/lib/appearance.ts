import { normalizeThemeId, randomThemeForDate, type ThemeId } from './themes'
export type Appearance = 'system' | 'light' | 'dark'
export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
export function tomorrow(): string {
  const date = new Date(); date.setDate(date.getDate() + 1); return localDate(date)
}
export function readPreferences(): { theme: ThemeId; appearance: Appearance; randomStart: string } {
  try {
    const value = JSON.parse(localStorage.getItem('appearance') ?? '{}')
    const randomStart = typeof value.randomStart === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.randomStart) ? value.randomStart : ''
    return { theme: randomStart && randomStart <= localDate() ? 'random' : normalizeThemeId(value.theme), appearance: ['light', 'dark'].includes(value.appearance) ? value.appearance : 'system', randomStart: randomStart > localDate() ? randomStart : '' }
  } catch { return { theme: 'iridescent', appearance: 'system', randomStart: '' } }
}
export function applyAppearance(theme: ThemeId, appearance: Appearance, randomStart = '') {
  document.documentElement.dataset.theme = theme === 'random' ? randomThemeForDate(localDate()) : theme
  document.documentElement.dataset.colorScheme = appearance === 'system'
    ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : appearance
  try { localStorage.setItem('appearance', JSON.stringify({ theme, appearance, randomStart })) } catch { /* Storage may be disabled. */ }
}
