// Only the logo color is customizable; typography is fixed in app.css.
export type Logo = { color: string }
export const DEFAULT_LOGO: Logo = { color: '#56c2f0' }
export function readLogo(): Logo {
  try {
    const value = JSON.parse(localStorage.getItem('logo') ?? '{}')
    return { color: typeof value?.color === 'string' && /^#[\da-f]{6}$/i.test(value.color) ? value.color : DEFAULT_LOGO.color }
  } catch { return { ...DEFAULT_LOGO } }
}
export function saveLogo(logo: Logo) {
  try { localStorage.setItem('logo', JSON.stringify(logo)) } catch { /* Storage may be disabled. */ }
}
