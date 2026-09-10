import { normalizeThemeId, randomThemeForDate, type ThemeId } from './themes'
export type Appearance = 'system' | 'light' | 'dark'
export function readPreferences(): { theme: ThemeId; appearance: Appearance } {
  try {
    const value = JSON.parse(localStorage.getItem('appearance') ?? '{}')
    return { theme: normalizeThemeId(value.theme), appearance: ['light', 'dark'].includes(value.appearance) ? value.appearance : 'system' }
  } catch { return { theme: 'random', appearance: 'system' } }
}
export function applyAppearance(theme: ThemeId, appearance: Appearance) {
  const date = new Date()
  const localDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  document.documentElement.dataset.theme = theme === 'random' ? randomThemeForDate(localDate) : theme
  document.documentElement.dataset.colorScheme = appearance === 'system'
    ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : appearance
  try { localStorage.setItem('appearance', JSON.stringify({ theme, appearance })) } catch { /* Storage may be disabled. */ }
}
