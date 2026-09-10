import { defineConfig } from '@playwright/test'
import { readFileSync, existsSync } from 'node:fs'
const { dev_test_port: port } = JSON.parse(readFileSync('port.json', 'utf8'))
export default defineConfig({
  outputDir: './test-results/dev',
  testDir: './tests', testMatch: 'dev.spec.ts', workers: 1, fullyParallel: false,
  use: {
    baseURL: `http://127.0.0.1:${port}`, trace: 'retain-on-failure',
    ...(existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? { channel: 'chrome' } : {}),
  },
  webServer: { command: 'node scripts/test-dev-server.mjs', url: `http://127.0.0.1:${port}/api/status`, reuseExistingServer: false, timeout: 120000 },
})
