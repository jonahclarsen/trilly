// Local macOS fonts: no network font requests or financial data in preferences.
export const LOGO_FONTS = [
  { id: 'system', name: 'System', family: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, sans-serif', weights: [400, 500, 600, 700, 800, 900] },
  { id: 'avenir-next', name: 'Avenir Next', family: '"Avenir Next", sans-serif', weights: [400, 500, 600, 700, 800] },
  { id: 'avenir', name: 'Avenir', family: 'Avenir, sans-serif', weights: [400, 500, 800, 900] },
  { id: 'helvetica-neue', name: 'Helvetica Neue', family: '"Helvetica Neue", sans-serif', weights: [300, 400, 500, 700] },
  { id: 'helvetica', name: 'Helvetica', family: 'Helvetica, sans-serif', weights: [400, 700] },
  { id: 'arial', name: 'Arial', family: 'Arial, sans-serif', weights: [400, 700] },
  { id: 'futura', name: 'Futura', family: 'Futura, sans-serif', weights: [500, 700] },
  { id: 'gill-sans', name: 'Gill Sans', family: '"Gill Sans", sans-serif', weights: [300, 400, 600, 700] },
  { id: 'trebuchet', name: 'Trebuchet MS', family: '"Trebuchet MS", sans-serif', weights: [400, 700] },
  { id: 'verdana', name: 'Verdana', family: 'Verdana, sans-serif', weights: [400, 700] },
] as const
export type Logo = { font: string; weight: number; spacing: number; color: string }
export const DEFAULT_LOGO: Logo = { font: 'system', weight: 800, spacing: -1.1, color: '' }
export function logoFont(id: string) { return LOGO_FONTS.find(font => font.id === id) ?? LOGO_FONTS[0] }
export function fontWeight(font: ReturnType<typeof logoFont>, preferred: number): number {
  return font.weights.reduce<number>((best, weight) => Math.abs(weight - preferred) < Math.abs(best - preferred) ? weight : best, font.weights[0])
}
export function readLogo(): Logo {
  try {
    const value = JSON.parse(localStorage.getItem('logo') ?? '{}')
    if (!Object.keys(value).length) return { ...DEFAULT_LOGO }
    const font = logoFont(value.font)
    return { font: font.id, weight: fontWeight(font, typeof value.weight === 'number' && Number.isFinite(value.weight) ? value.weight : DEFAULT_LOGO.weight),
      spacing: typeof value.spacing === 'number' && Number.isFinite(value.spacing) ? Math.max(-2, Math.min(5, value.spacing)) : DEFAULT_LOGO.spacing,
      color: typeof value.color === 'string' && /^#[\da-f]{6}$/i.test(value.color) ? value.color : '' }
  } catch { return { ...DEFAULT_LOGO } }
}
export function saveLogo(logo: Logo) {
  try { localStorage.setItem('logo', JSON.stringify(logo)) } catch { /* Storage may be disabled. */ }
}
