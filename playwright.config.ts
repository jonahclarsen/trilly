import { defineConfig } from '@playwright/test'
import { readFileSync, existsSync } from 'node:fs'
const { port } = JSON.parse(readFileSync('port.json', 'utf8'))
export default defineConfig({
  testDir: './tests', fullyParallel: false, workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${port}`, viewport: { width: 1280, height: 900 },
    trace: 'retain-on-failure',
    ...(existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? { channel: 'chrome' } : {}),
  },
  webServer: { command: 'pnpm build && node scripts/test-server.mjs', url: `http://127.0.0.1:${port}`, reuseExistingServer: false, timeout: 120000 },
})
