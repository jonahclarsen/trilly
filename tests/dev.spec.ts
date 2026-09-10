import { test, expect } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { request } from 'node:http'

function fetchStatus(url: string, headers: Record<string, string>) {
  return new Promise<number | undefined>((resolve, reject) => {
    const req = request(url, { headers }, response => { response.resume(); resolve(response.statusCode) })
    req.once('error', reject); req.end()
  })
}

test('development proxy blocks foreign origins, hosts, and unmarked API requests', async ({ baseURL }) => {
  expect(await fetchStatus(`${baseURL}/api/status`, { Origin: 'https://foreign.invalid', 'x-trilly': '1' })).toBe(403)
  expect(await fetchStatus(`${baseURL}/`, { Host: 'foreign.invalid' })).toBe(403)
  expect(await fetchStatus(`${baseURL}/api/status`, {})).toBe(403)
  expect(await fetchStatus(`${baseURL}/api/status`, { 'x-trilly': '1' })).toBe(200)
  expect(await fetchStatus(`${baseURL}/api/state`, { 'x-trilly': '1' })).toBe(401)
})

test('component hot updates preserve the session and explicit lock without another unlock', async ({ page }) => {
  let unlocks = 0
  page.on('request', request => { if (request.url().endsWith('/api/unlock')) unlocks++ })
  await page.goto('/')
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
  expect(unlocks).toBe(1)
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  const source = new URL('../src/App.svelte', import.meta.url)
  const original = await readFile(source, 'utf8')
  try {
    await writeFile(source, original.replace('Open your saved vault.', 'Synthetic hot update one.'))
    // The hot update recreates the component and reads the existing session.
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
    expect(unlocks).toBe(1)
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await page.getByRole('button', { name: 'Lock', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Locked', exact: true })).toBeVisible()
    await expect(page.getByText('Synthetic hot update one.')).toBeVisible()
    await writeFile(source, original.replace('Open your saved vault.', 'Synthetic hot update two.'))
    await expect(page.getByText('Synthetic hot update two.')).toBeVisible()
    expect(unlocks).toBe(1)
    expect(await page.evaluate(() => Object.keys(sessionStorage))).toEqual([])
    expect(await page.evaluate(() => Object.keys(localStorage).filter(key => !['appearance', 'logo'].includes(key)))).toEqual([])
  } finally { await writeFile(source, original) }
})

test('Rust changes rebuild the signed bundle and reload into a fresh session', async ({ page }) => {
  test.setTimeout(60000)
  let unlocks = 0
  page.on('request', request => { if (request.url().endsWith('/api/unlock')) unlocks++ })
  await expect(async () => {
    await page.goto('/')
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 10000, intervals: [2200] })
  const initialUnlocks = unlocks
  const source = new URL('../server/src/main.rs', import.meta.url)
  const original = await readFile(source, 'utf8')
  try {
    await writeFile(source, original + '\n// Synthetic runner rebuild verification.\n')
    await expect.poll(() => unlocks, { timeout: 45000 }).toBe(initialUnlocks + 1)
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
  } finally { await writeFile(source, original) }
})
