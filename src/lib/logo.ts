// Logo weight and color are local preferences; font and spacing stay fixed.
export type Logo = { color: string; weight: number }
export const DEFAULT_LOGO: Logo = { color: '#56c2f0', weight: 750 }
export const LOGO_WEIGHT_MIN = 100
export const LOGO_WEIGHT_MAX = 900
export function readLogo(): Logo {
  try {
    const value = JSON.parse(localStorage.getItem('logo') ?? '{}')
    return {
      color: typeof value?.color === 'string' && /^#[\da-f]{6}$/i.test(value.color) ? value.color : DEFAULT_LOGO.color,
      weight: typeof value?.weight === 'number' && Number.isFinite(value.weight)
        ? Math.max(LOGO_WEIGHT_MIN, Math.min(LOGO_WEIGHT_MAX, Math.round(value.weight))) : DEFAULT_LOGO.weight,
    }
  } catch { return { ...DEFAULT_LOGO } }
}
export function saveLogo(logo: Logo) {
  try { localStorage.setItem('logo', JSON.stringify(logo)) } catch { /* Storage may be disabled. */ }
}
