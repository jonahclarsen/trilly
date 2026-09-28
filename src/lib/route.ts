// Pages that have their own URL path, so reloading or revisiting reopens them.
export type Page = 'transaction' | 'list' | 'settings' | 'business' | 'help' | 'rules'

const paths: Record<Page, string> = {
  transaction: '/', list: '/list', settings: '/settings', business: '/business', help: '/help', rules: '/rules',
}

export function pagePath(page: Page) { return paths[page] }

export function pageFromPath(path: string): Page {
  const normalized = path.replace(/\/+$/, '') || '/'
  return (Object.keys(paths) as Page[]).find(page => paths[page] === normalized) ?? 'transaction'
}
