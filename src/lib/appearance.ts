import { normalizeThemeId, randomThemeForDate, type ThemeId } from './themes'
export type Appearance = 'system' | 'light' | 'dark'
export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
export function tomorrow(): string {
  const date = new Date(); date.setDate(date.getDate() + 1); return localDate(date)
}
// Iridescent hues drift by the same daily amount; days roll over at 4 a.m.
export function iridescentHueShift(now = new Date()): number {
  const day = new Date(now)
  if (day.getHours() < 4) day.setDate(day.getDate() - 1)
  let hash = 2166136261
  for (const char of localDate(day)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  hash = Math.imul(hash ^ hash >>> 16, 0x85ebca6b); hash = Math.imul(hash ^ hash >>> 13, 0xc2b2ae35); hash ^= hash >>> 16
  return Math.round((hash >>> 0) / 2 ** 32 * 60) - 30
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
  const hue = String(iridescentHueShift())
  if (document.documentElement.style.getPropertyValue('--iridescent-hue-shift') !== hue) document.documentElement.style.setProperty('--iridescent-hue-shift', hue)
  document.documentElement.dataset.colorScheme = appearance === 'system'
    ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : appearance
  try { localStorage.setItem('appearance', JSON.stringify({ theme, appearance, randomStart })) } catch { /* Storage may be disabled. */ }
}
