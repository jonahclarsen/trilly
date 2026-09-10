import { test, expect } from '@playwright/test'
import { mkdir, readFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { resolve, sep, extname } from 'node:path'
import { createRequire } from 'node:module'
import { mockApp } from './fixtures'

let server: Server
let origin: string

test.beforeAll(async () => {
  // A temporary OS-assigned test port. Never connects to the permanent app port,
  // starts the Rust backend, or touches an installed vault.
  const root = resolve('dist')
  server = createServer(async (request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
    const path = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`)
    if (!path.startsWith(root + sep) || pathname.startsWith('/api/')) {
      response.writeHead(403).end(); return
    }
    try {
      const body = await readFile(path)
      const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }
      response.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' }).end(body)
    } catch { response.writeHead(404).end() }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Preview address unavailable')
  origin = `http://127.0.0.1:${address.port}`
  await mkdir('docs/screenshots', { recursive: true })
})

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
})

test('publish synthetic light and dark WebP screenshots', async ({ page }) => {
  // Load the native encoder through CommonJS to avoid Node 24's ESM/semver
  // cycle under Playwright's TypeScript loader.
  const sharp: typeof import('sharp').default = createRequire(import.meta.url)('sharp')
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    // API calls must be handled by mockApp, registered below with higher priority.
    if (url.origin !== origin || url.pathname.startsWith('/api/')) return route.abort()
    return route.continue()
  })
  await page.addInitScript(() => localStorage.setItem('appearance', JSON.stringify({ theme: 'iridescent', appearance: 'system' })))
  await page.clock.install({ time: new Date('2026-09-09T21:05:00Z') })
  await mockApp(page, { url: origin })
  await expect(page.getByRole('button', { name: /24 similar transactions/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sync', exact: true })).toBeEnabled()
  await page.locator('.workspace').focus()

  for (const mode of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: mode })
    await expect(page.locator('html')).toHaveAttribute('data-color-scheme', mode)
    await page.locator('.workspace').focus()
    await page.mouse.move(0, 0)
    const capture = await page.screenshot({ type: 'png', animations: 'disabled', fullPage: true })
    await sharp(capture).webp({ quality: 88, effort: 6 }).toFile(`docs/screenshots/review-${mode}.webp`)
    await page.setViewportSize({ width: 1280, height: 1160 })
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const settings = page.getByRole('dialog', { name: 'Settings' })
    await expect(settings).toBeVisible()
    expect(await settings.evaluate(node => node.scrollHeight <= node.clientHeight)).toBe(true)
    await sharp(await settings.screenshot({ type: 'png', animations: 'disabled' })).webp({ quality: 88, effort: 6 }).toFile(`docs/screenshots/settings-${mode}.webp`)
    await page.keyboard.press('Escape')
    await page.setViewportSize({ width: 1280, height: 940 })
  }
})
