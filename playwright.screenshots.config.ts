import { defineConfig } from '@playwright/test'
import { existsSync } from 'node:fs'

export default defineConfig({
  testDir: './tests',
  testMatch: 'screenshots.spec.ts',
  workers: 1,
  use: {
    viewport: { width: 1280, height: 940 },
    locale: 'en-CA',
    timezoneId: 'America/Vancouver',
    reducedMotion: 'reduce',
    ...(existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? { channel: 'chrome' } : {}),
  },
})
