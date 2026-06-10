import {defineConfig} from 'vitest/config'
import react from '@vitejs/plugin-react'

/**
 * Standalone browser-mode config for `*.evidence.tsx` capture stories.
 *
 * Kept separate from your normal test config so:
 *   - evidence stories (no assertions) don't run in your CI test suite, and
 *   - prshot can run the SAME config against any branch, including ones that
 *     predate your browser-test setup, as long as deps are installed.
 *
 * Adapt plugins/resolve to match your app. The key bits are browser mode +
 * the Playwright provider + headless Chromium.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    name: 'evidence',
    include: ['**/*.evidence.tsx'],
    testTimeout: 60_000,
    browser: {
      enabled: true,
      provider: 'playwright',
      headless: true,
      instances: [{browser: 'chromium'}],
    },
  },
})
