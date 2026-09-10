import { test, expect } from '@playwright/test'
import { mockApp, suggestions } from './fixtures'

test('native unlock opens automatically without a browser password and lock revokes access', async ({ page }) => {
  const unlockRequests: unknown[] = []
  page.on('request', request => { if (request.url().endsWith('/api/unlock')) unlockRequests.push(request.postDataJSON()) })
  await page.goto('/')
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
  await expect(page.getByLabel('Passphrase', { exact: true })).toHaveCount(0)
  expect(unlockRequests[0]).toEqual({})
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Lock', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Locked', exact: true })).toBeVisible()
  const privateRead = await page.request.get('/api/state', { headers: { 'x-trilly': '1' } })
  expect(privateRead.status()).toBe(401)
  await expect(async () => {
    await page.getByRole('button', { name: 'Unlock', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 10000, intervals: [2200] })
  expect(unlockRequests.every(body => JSON.stringify(body) === '{}')).toBe(true)
})

test('cancelled macOS authentication stays locked and offers an explicit retry', async ({ page }) => {
  let prompts = 0
  await page.route('**/api/status', route => route.fulfill({ json: { exists: true, mode: 'macos' } }))
  await page.route('**/api/unlock', route => { prompts++; return route.fulfill({ status: 400, json: { error: 'Unlock cancelled or authentication denied' } }) })
  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText('Unlock cancelled')
  await expect(page.getByRole('heading', { name: 'Locked', exact: true })).toBeVisible()
  expect(prompts).toBe(1)
  await expect(page.locator('input[type="password"]')).toHaveCount(0)
  await page.keyboard.press('Enter')
  await expect.poll(() => prompts).toBe(2)
})

test('legacy migration requests only the old vault passphrase once', async ({ page }) => {
  let request: unknown
  await page.route('**/api/status', route => route.fulfill({ json: { exists: true, mode: 'migration' } }))
  await page.route('**/api/unlock', route => {
    request = route.request().postDataJSON()
    return route.fulfill({ status: 400, json: { error: 'Synthetic migration cancellation' } })
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Switch to macOS unlock' })).toBeVisible()
  expect(request).toBeUndefined()
  await page.getByLabel('Existing vault passphrase').fill('synthetic old vault passphrase')
  await page.getByRole('button', { name: 'Migrate', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Synthetic migration cancellation')
  expect(request).toEqual({ legacy_passphrase: 'synthetic old vault passphrase' })
})

test('one-key suggestions, category search, undo and skip', async ({ page }) => {
  const actions = await mockApp(page)
  await expect(page.getByRole('button', { name: /24 similar transactions/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sync', exact: true })).toBeEnabled()
  await page.keyboard.press('2')
  await expect(page.getByRole('heading', { name: 'Brew House', exact: true })).toBeVisible()
  expect(actions.find(a => a.action === 'review')).toMatchObject({ id: 'one', payee_id: 'market', category_id: 'dining' })
  await page.keyboard.press('c')
  await page.getByRole('combobox', { name: 'Search category' }).fill('coff')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Category Coffee C' })).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Whole Foods', exact: true })).toBeVisible()
  expect(actions.filter(a => a.action === 'review')[1]).toMatchObject({ id: 'two', category_id: 'coffee' })
  await page.keyboard.press('u')
  await expect(page.getByRole('heading', { name: 'Brew House', exact: true })).toBeVisible()
  await page.keyboard.press('s')
  await expect(page.getByRole('heading', { name: 'Whole Foods', exact: true })).toBeVisible()
  await page.keyboard.press('s')
  await expect(page.getByRole('heading', { name: 'All remaining skipped' })).toBeVisible()
  await page.getByRole('button', { name: 'Review skipped' }).click()
  await expect(page.getByRole('heading', { name: 'Brew House', exact: true })).toBeVisible()
})

test('theme selection persists, follows system appearance, and stays within viewport', async ({ page }) => {
  await mockApp(page)
  await page.keyboard.press(',')
  await expect(page.getByRole('button', { name: 'Iridescent', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Graphite', exact: true }).click()
  await page.getByRole('button', { name: 'System', exact: true }).first().click()
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'dark')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'graphite')
  await expect(page).toHaveTitle('Trilly')
  await expect(page.locator('header > .brand')).toHaveText('trilly')
  await expect(page.locator('header > .brand')).toHaveCSS('color', 'rgb(56, 189, 248)')
  await expect(page.getByLabel('Logo color', { exact: true })).toHaveValue('#38bdf8')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.screenshot({ path: 'test-results/review-dark.png', fullPage: true, animations: 'disabled' })
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'light')
  await page.screenshot({ path: 'test-results/review-light.png', fullPage: true, animations: 'disabled' })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/review-mobile.png', fullPage: true, animations: 'disabled' })
  const storage = await page.evaluate(() => ({ ...localStorage }))
  expect(Object.keys(storage).sort()).toEqual(['appearance', 'logo'])
  expect(storage.appearance).not.toContain('synthetic')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'graphite')
})

test('failed sync leaves pending work visible and supports retry', async ({ page }) => {
  await mockApp(page, { syncError: true })
  await expect(page.getByRole('button', { name: 'Sync', exact: true })).toBeEnabled()
  await page.locator('.workspace').focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Brew House', exact: true })).toBeVisible()
  await page.keyboard.press('r')
  await expect(page.getByRole('alert')).toContainText('Changes remain saved locally')
  await expect(page.locator('.sync-state')).toHaveText('1 pending')
})

test('transfers only allow approval and lock clears displayed data', async ({ page }) => {
  await mockApp(page, { special: true })
  await expect(page.getByText('Transfer', { exact: true })).toBeVisible()
  await page.keyboard.press('c')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Edit in YNAB' })).toBeVisible()
  await page.keyboard.press('l')
  await expect(page.getByRole('heading', { name: 'Locked', exact: true })).toBeVisible()
  await expect(page.getByText('Whole Foods', { exact: true })).toHaveCount(0)
})

test('sync preserves a draft category and typing never triggers global shortcuts', async ({ page }) => {
  const actions = await mockApp(page)
  await expect(page.getByRole('button', { name: 'Sync', exact: true })).toBeEnabled()
  await page.keyboard.press('c')
  await page.getByRole('combobox', { name: 'Search category' }).fill('dining')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'Category Dining out C' })).toBeVisible()
  await page.keyboard.press('r')
  await expect(page.getByRole('button', { name: 'Sync', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Category Dining out C' })).toBeVisible()
  await page.keyboard.press('e')
  await page.getByRole('combobox', { name: 'Search payee' }).fill('123surcl')
  await expect(page.getByText('No matches', { exact: true })).toBeVisible()
  expect(actions.filter(a => ['review', 'undo', 'lock'].includes(a.action as string))).toHaveLength(0)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('pickers focus search from keyboard and buttons; every modal dismisses outside', async ({ page }) => {
  await mockApp(page)
  await expect(page.getByRole('button', { name: 'Sync', exact: true })).toBeEnabled()
  for (const key of ['e', 'c', 'a']) {
    await page.keyboard.press(key)
    await expect(page.getByRole('combobox')).toBeFocused()
    await page.keyboard.type('zznope')
    await expect(page.getByText('No matches', { exact: true })).toBeVisible()
    await page.mouse.click(5, 5)
    await expect(page.getByRole('dialog')).toHaveCount(0)
  }
  await page.getByRole('button', { name: 'Payee Whole Foods E' }).click()
  await expect(page.getByRole('combobox', { name: 'Search payee' })).toBeFocused()
  await page.keyboard.type('brew')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'Payee Brew House E' })).toBeVisible()
  for (const name of ['Help', 'Settings']) {
    await page.getByRole('button', { name, exact: true }).click()
    const dialog = page.getByRole('dialog', { name })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('heading', { name }).click()
    await expect(dialog).toBeVisible()
    await page.mouse.click(5, 5)
    await expect(dialog).toHaveCount(0)
  }
})

test('logo controls persist and token replacement stays hidden until requested', async ({ page }) => {
  await mockApp(page)
  await page.keyboard.press(',')
  await expect(page.getByLabel('Replace access token', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Get a token' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Replace access token', exact: true }).click()
  await expect(page.getByLabel('Replace access token', { exact: true })).toBeFocused()
  await expect(page.getByRole('link', { name: 'Get a token' })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByLabel('Replace access token', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('group', { name: 'Logo font', exact: true })).toHaveCount(0)
  await expect(page.getByRole('slider', { name: /Letter spacing/ })).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: 'Logo hex color' })).toHaveValue('#56c2f0')
  const weight = page.getByRole('slider', { name: 'Logo weight', exact: true })
  await expect(weight).toHaveValue('750')
  await weight.focus()
  await page.keyboard.press('ArrowRight')
  await expect(weight).toHaveValue('751')
  await expect(page.locator('header > .brand')).toHaveCSS('font-weight', '751')
  await page.getByRole('textbox', { name: 'Logo hex color' }).fill('#aa3377')
  await expect(page.locator('header > .brand')).toHaveCSS('color', 'rgb(170, 51, 119)')
  await page.getByRole('slider', { name: 'Hue', exact: true }).focus()
  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowRight')
  const color = await page.locator('header > .brand').evaluate(node => getComputedStyle(node).color)
  expect(color).not.toBe('rgb(170, 51, 119)')
  await page.keyboard.press('Escape')
  await page.reload()
  await expect(page.locator('header > .brand')).toHaveCSS('font-family', '"Avenir Next", sans-serif')
  await expect(page.locator('header > .brand')).toHaveCSS('font-weight', '751')
  await expect(page.locator('header > .brand')).toHaveCSS('letter-spacing', '-0.8px')
  await expect(page.locator('header > .brand')).toHaveCSS('color', color)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.keyboard.press(',')
  expect(await page.getByRole('dialog').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
  await page.getByRole('button', { name: 'Reset logo', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Logo hex color' })).toHaveValue('#56c2f0')
  await expect(page.locator('header > .brand')).toHaveCSS('color', 'rgb(86, 194, 240)')
  await expect(weight).toHaveValue('750')
  await expect(page.locator('header > .brand')).toHaveCSS('font-weight', '750')
})

test('Random can start tomorrow, survive reload, and be cancelled', async ({ page }) => {
  await page.clock.install({ time: new Date(2026, 8, 9, 23, 59, 0) })
  await mockApp(page)
  await page.keyboard.press(',')
  await page.getByRole('button', { name: 'Start tomorrow', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'iridescent')
  await page.reload()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Cancel start', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel start', exact: true }).click()
  await page.clock.fastForward(70_000)
  await expect(page.getByRole('button', { name: 'Iridescent', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Start tomorrow', exact: true }).click()
  // Simulate waking after the next midnight without six hours of inactivity.
  await page.clock.setSystemTime(new Date(2026, 8, 11, 0, 1, 0))
  await page.keyboard.press('Shift')
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect(page.getByRole('button', { name: 'Random', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Start tomorrow', exact: true })).toHaveCount(0)
})

test('six-hour inactivity lock handles a sleeping browser and user activity resets it', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-09T12:00:00Z') })
  const actions = await mockApp(page)
  await page.clock.fastForward(11 * 60_000)
  await expect(page.getByRole('heading', { name: 'Whole Foods', exact: true })).toBeVisible()
  await page.clock.fastForward(5 * 60 * 60_000)
  await page.keyboard.press('Shift')
  await page.clock.fastForward(59 * 60_000)
  await expect(page.getByRole('heading', { name: 'Whole Foods', exact: true })).toBeVisible()
  await page.clock.setSystemTime(new Date('2026-09-09T23:12:00Z'))
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect(page.getByRole('heading', { name: 'Locked', exact: true })).toBeVisible()
  expect(actions.some(action => action.action === 'lock')).toBe(true)
})

test('sync status uses today with a time, then a date after midnight', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-09T21:05:00Z') })
  await mockApp(page)
  await expect(page.locator('.sync-state')).toContainText('Last synced at today,')
  await page.clock.setSystemTime(new Date('2026-09-11T21:05:00Z'))
  await page.keyboard.press('Shift')
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect(page.locator('.sync-state')).toContainText('Last synced at Sep')
  await expect(page.locator('.sync-state')).not.toContainText('today')
})

test('a Keychain access error leaves Unlock usable and retries native authentication', async ({ page }) => {
  await mockApp(page)
  let attempts = 0
  await page.route('**/api/unlock', route => {
    attempts++
    if (attempts < 3) return route.fulfill({ status: 400, json: { error: 'Trilly could not authorize this signed app to access the vault key. Unlock again and allow the native Keychain access update.' } })
    return route.fallback()
  })
  await page.reload()
  await expect(page.getByRole('alert')).toContainText('authorize this signed app')
  await expect(page.getByRole('button', { name: 'Unlock', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Unlock', exact: true }).click()
  await expect.poll(() => attempts).toBe(2)
  await expect(page.getByRole('button', { name: 'Unlock', exact: true })).toBeEnabled()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Whole Foods', exact: true })).toBeVisible()
  expect(attempts).toBe(3)
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('empty suggestions stay hidden and refresh after syncing the same transaction', async ({ page }) => {
  await mockApp(page)
  await expect(page.getByRole('button', { name: 'Sync', exact: true })).toBeEnabled()
  let matches = false
  await page.route('**/api/suggestions/*', route => route.fulfill({ json: matches ? suggestions : [] }))
  await page.keyboard.press('r')
  await expect(page.getByRole('region', { name: 'Suggestions' })).toHaveCount(0)
  await expect(page.getByText(/No matching approved history|Choose & approve/)).toHaveCount(0)
  matches = true
  await page.keyboard.press('r')
  await expect(page.getByRole('button', { name: /24 similar transactions/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Whole Foods', exact: true })).toBeVisible()
})

test('one Escape closes every modal and picker search keeps focus without an outline', async ({ page }) => {
  await mockApp(page)
  await expect(page.getByRole('button', { name: 'Sync', exact: true })).toBeEnabled()
  for (const key of ['e', 'c', 'a', ',', '?']) {
    await page.locator('.workspace').focus()
    await page.keyboard.press(key)
    await expect(page.getByRole('dialog')).toBeVisible()
    if (['e', 'c', 'a'].includes(key)) {
      const search = page.getByRole('combobox')
      await expect(search).toBeFocused()
      await page.keyboard.type('e')
      await expect(search).toBeFocused()
      await expect(search).toHaveCSS('outline-style', 'none')
    }
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
  }
})


test('navigation uses visible icon buttons and centers the sync status', async ({ page }) => {
  await mockApp(page)
  await expect(page.getByRole('button', { name: 'Sync', exact: true })).toBeEnabled()
  const nav = page.getByRole('navigation', { name: 'App controls' })
  const status = await nav.locator('.sync-state').boundingBox()
  for (const name of ['Sync', 'Undo', 'Help', 'Settings', 'Lock']) {
    const button = nav.getByRole('button', { name, exact: true })
    await expect(button.locator('svg')).toBeVisible()
    await expect(button).toContainText(name)
    await expect(button).toHaveCSS('border-top-style', 'solid')
    expect(await button.evaluate(node => getComputedStyle(node).borderTopColor)).not.toBe('rgba(0, 0, 0, 0)')
    const box = await button.boundingBox()
    expect(Math.abs((box!.y + box!.height / 2) - (status!.y + status!.height / 2))).toBeLessThan(1)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('preloads suggestions and queues number keys and Command-Z behind a slow save', async ({ page }) => {
  const loaded = new Set<string>()
  page.on('response', response => { if (response.url().includes('/api/suggestions/')) loaded.add(response.url().split('/').at(-1)!) })
  const actions = await mockApp(page)
  await expect.poll(() => loaded.has('two') && loaded.has('three')).toBe(true)
  await expect(page.getByRole('button', { name: 'Sync', exact: true })).toBeEnabled()
  let release!: () => void
  const gate = new Promise<void>(resolve => release = resolve)
  let started = false
  await page.route('**/api/action', async route => {
    if (route.request().postDataJSON().action === 'review' && !started) { started = true; await gate }
    await route.fallback()
  })
  try {
    await page.keyboard.press('1')
    await expect(page.getByRole('heading', { name: 'Brew House', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /24 similar transactions/ })).toBeEnabled()
    await page.keyboard.press('2')
    await expect(page.locator('.amount')).toContainText('19.30')
    await page.keyboard.press('Meta+z')
    await expect(page.getByRole('heading', { name: 'Brew House', exact: true })).toBeVisible()
    await expect(page.locator('.sync-state')).toHaveText('3 saving')
    expect(actions.filter(a => a.action === 'review')).toHaveLength(0)
  } finally { release() }
  await expect(page.locator('.sync-state')).not.toContainText('saving')
  expect(actions.filter(a => ['review', 'undo'].includes(a.action as string)).map(a => a.action)).toEqual(['review', 'review', 'undo'])
  await expect(page.getByRole('heading', { name: 'Brew House', exact: true })).toBeVisible()
})

test('failed save cancels later queued actions and reloads authoritative state', async ({ page }) => {
  const actions = await mockApp(page)
  await expect(page.getByRole('button', { name: 'Sync', exact: true })).toBeEnabled()
  let release!: () => void
  const gate = new Promise<void>(resolve => release = resolve)
  await page.route('**/api/action', async route => {
    if (route.request().postDataJSON().action === 'review') {
      await gate
      await route.fulfill({ status: 500, json: { error: 'Synthetic save failure' } })
    } else await route.fallback()
  })
  try {
    await page.keyboard.press('1')
    await expect(page.getByRole('heading', { name: 'Brew House', exact: true })).toBeVisible()
    await page.keyboard.press('Meta+z')
  } finally { release() }
  await expect(page.getByRole('alert')).toContainText('Save could not be confirmed')
  await expect(page.getByRole('button', { name: /24 similar transactions/ })).toBeDisabled()
  await page.getByRole('button', { name: 'Reload saved state' }).click()
  await expect(page.getByRole('button', { name: /24 similar transactions/ })).toBeEnabled()
  expect(actions.filter(a => a.action === 'undo')).toHaveLength(0)
})

test('Escape closes a populated payee search before an input handler consumes it', async ({ page }) => {
  await mockApp(page)
  await page.keyboard.press('e')
  const search = page.getByRole('combobox', { name: 'Search payee' })
  await search.fill('Brew')
  // Model a browser/input handler consuming Escape before it can bubble.
  await search.evaluate(input => input.addEventListener('keydown', event => {
    if ((event as KeyboardEvent).key === 'Escape') event.stopPropagation()
  }))
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('suggestion keys remain active during a slow sync', async ({ page }) => {
  const actions = await mockApp(page)
  await expect(page.getByRole('button', { name: 'Sync', exact: true })).toBeEnabled()
  let release!: () => void
  const gate = new Promise<void>(resolve => release = resolve)
  await page.route('**/api/action', async route => {
    if (route.request().postDataJSON().action === 'sync') await gate
    await route.fallback()
  })
  try {
    await page.keyboard.press('r')
    await page.keyboard.press('3')
    await expect(page.getByRole('heading', { name: 'Brew House', exact: true })).toBeVisible()
    await page.keyboard.press('Meta+z')
    await expect(page.locator('.amount')).toContainText('84.27')
  } finally { release() }
  await expect(page.locator('.sync-state')).not.toContainText('saving')
  expect(actions.filter(a => ['review', 'undo'].includes(a.action as string)).map(a => a.action)).toEqual(['review', 'undo'])
})


test('undo stays visible while its durable reverse syncs before the next review', async ({ page }) => {
  const actions = await mockApp(page, { durableUndo: true })
  await expect(page.getByRole('button', { name: 'Sync', exact: true })).toBeEnabled()
  await page.keyboard.press('1')
  await expect(page.getByRole('heading', { name: 'Brew House', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sync', exact: true })).toBeEnabled()
  let release!: () => void
  const gate = new Promise<void>(resolve => release = resolve)
  let reversing = false
  await page.route('**/api/action', async route => {
    if (route.request().postDataJSON().action === 'sync') { reversing = true; await gate }
    await route.fallback()
  })
  try {
    await page.keyboard.press('Meta+z')
    await expect.poll(() => reversing).toBe(true)
    await expect(page.locator('.amount')).toContainText('84.27')
    await page.keyboard.press('2')
    await expect(page.getByRole('heading', { name: 'Brew House', exact: true })).toBeVisible()
    expect(actions.filter(a => a.action === 'review')).toHaveLength(1)
  } finally { release() }
  await expect(page.getByRole('button', { name: 'Sync', exact: true })).toBeEnabled()
  expect(actions.filter(a => a.action === 'review')).toHaveLength(2)
  await expect(page.getByRole('heading', { name: 'Brew House', exact: true })).toBeVisible()
})

test('number shortcuts reach suggestions when a focused control consumes bubbling events', async ({ page }) => {
  const actions = await mockApp(page)
  const suggestion = page.getByRole('button', { name: /24 similar transactions/ })
  await expect(suggestion).toBeEnabled()
  await suggestion.focus()
  await suggestion.evaluate(button => button.addEventListener('keydown', event => event.stopPropagation()))
  await page.keyboard.press('2')
  await expect.poll(() => actions.find(action => action.action === 'review')).toMatchObject({
    id: 'one', payee_id: 'market', category_id: 'dining',
  })
})

for (const [key, code] of [['&', 'Digit1'], ['ArrowDown', 'Numpad2'], ['3', 'Numpad3']]) {
  test(`suggestion shortcut recognizes ${code} producing ${key}`, async ({ page }) => {
    const actions = await mockApp(page)
    const suggestion = page.getByRole('button', { name: /24 similar transactions/ })
    await expect(suggestion).toBeEnabled()
    await suggestion.dispatchEvent('keydown', { key, code, bubbles: true })
    const expected = suggestions[Number(code.at(-1)) - 1]
    await expect.poll(() => actions.find(action => action.action === 'review')).toMatchObject({
      id: 'one', payee_id: expected.payee_id, category_id: expected.category_id,
    })
  })
}

test('physical number shortcuts ignore typing, dialogs, modifiers, composition and repeats', async ({ page }) => {
  const actions = await mockApp(page)
  const suggestion = page.getByRole('button', { name: /24 similar transactions/ })
  await expect(suggestion).toBeEnabled()
  for (const flags of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }, { isComposing: true }, { repeat: true }]) {
    await suggestion.dispatchEvent('keydown', { key: '&', code: 'Digit1', bubbles: true, ...flags })
  }
  await page.keyboard.press('e')
  const search = page.getByRole('combobox')
  await search.dispatchEvent('keydown', { key: '&', code: 'Digit1', bubbles: true })
  await page.getByRole('button', { name: 'Close', exact: true }).dispatchEvent('keydown', { key: '1', code: 'Digit1', bubbles: true })
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.locator('.workspace').evaluate(workspace => {
    const input = document.createElement('input')
    input.setAttribute('aria-label', 'Synthetic typing fixture')
    workspace.append(input)
  })
  await page.getByLabel('Synthetic typing fixture').press('1')
  await expect(page.getByLabel('Synthetic typing fixture')).toHaveValue('1')
  expect(actions.filter(action => action.action === 'review')).toHaveLength(0)
})


test('business expense keyboard entry, copy, reload, archive and undo', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const actions = await mockApp(page)
  await expect(page.getByRole('button', { name: 'Sync', exact: true })).toBeEnabled()
  await page.keyboard.press('b')
  await expect(page.getByLabel('Description', { exact: true })).toBeFocused()
  await page.getByLabel('Description', { exact: true }).fill('Office supplies')
  await page.keyboard.press('Tab')
  await expect(page.getByLabel('Note (optional)')).toBeFocused()
  await page.getByLabel('Note (optional)').fill('Receipt filed')
  await page.getByRole('button', { name: 'Save expense Enter', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Business saved B' })).toBeDisabled()
  expect(actions.find(a => a.action === 'business_expense')).toEqual({ action: 'business_expense', id: 'one', description: 'Office supplies', note: 'Receipt filed' })
  await page.reload()
  await page.getByRole('button', { name: 'Business expenses (1)', exact: true }).click()
  await expect(page.getByRole('cell', { name: 'Office supplies', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Copy to sheet', exact: true }).click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('Office supplies\t2026-09-08\t84.27\tEveryday card\tReceipt filed')
  await page.getByRole('button', { name: 'Archive all', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Undo archive ⌘Z / U', exact: true })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: 'Business expenses (0)', exact: true }).click()
  await page.getByRole('button', { name: 'Show archived', exact: true }).click()
  await expect(page.getByRole('cell', { name: 'Office supplies', exact: true })).toBeVisible()
  await page.keyboard.press('u')
  await page.getByRole('button', { name: 'Show current', exact: true }).click()
  await expect(page.getByRole('cell', { name: 'Office supplies', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Remove expense: Office supplies', exact: true }).click()
  await expect(page.getByRole('cell', { name: 'Office supplies', exact: true })).toHaveCount(0)
  await page.keyboard.press('u')
  await expect(page.getByRole('cell', { name: 'Office supplies', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.keyboard.press('u')
  await expect(page.getByRole('button', { name: 'Business expenses (0)', exact: true })).toBeVisible()
  await page.keyboard.press('b')
  await expect(page.getByRole('dialog', { name: 'Add business expense', exact: true })).toBeVisible()
  await page.getByLabel('Description', { exact: true }).fill('Replacement supplies')
  await expect(page.getByRole('button', { name: 'Save expense Enter', exact: true })).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Business expenses (1)', exact: true })).toBeVisible()
})

test('spreadsheet rows preserve precision and neutralize formulas and cell separators', async () => {
  const { businessRows } = await import('../src/lib/business')
  expect(businessRows([{ plan_id: 'synthetic', transaction_id: 'synthetic', description: '=SUM(1,2)\nsecond line', date: '2026-09-08', amount: -12345, account: '+Card\tname', note: '@note', archived: false }])).toBe("'=SUM(1,2) second line\t2026-09-08\t-12.345\t'+Card name\t'@note")
})


test('business description selects the chosen payee and D saves a transaction description', async ({ page }) => {
  const actions = await mockApp(page)
  await expect(page.getByRole('button', { name: 'Sync', exact: true })).toBeEnabled()
  await page.keyboard.press('e')
  await page.getByRole('combobox', { name: 'Search payee' }).fill('Brew House')
  await page.keyboard.press('Enter')
  await page.keyboard.press('b')
  const description = page.getByLabel('Description', { exact: true })
  await expect(description).toHaveValue('Brew House')
  await expect(description).toBeFocused()
  expect(await description.evaluate((node: HTMLTextAreaElement) => [node.selectionStart, node.selectionEnd])).toEqual([0, 10])
  await page.keyboard.type('New business description')
  await expect(description).toHaveValue('New business description')
  await page.keyboard.press('Escape')
  await page.keyboard.press('d')
  await expect(page.getByRole('dialog', { name: 'Description', exact: true })).toBeVisible()
  await expect(description).toBeFocused()
  await description.fill('Project materials')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.memo')).toHaveText('Project materials')
  expect(actions.find(a => a.action === 'description')).toEqual({ action: 'description', id: 'one', description: 'Project materials' })
  expect(actions.some(a => a.action === 'review')).toBe(false)
})
