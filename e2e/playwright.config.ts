import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests load the real built extension in Chromium on the local fake Meet page, against the mock API.
 * Build first: `pnpm --filter @audion/e2e build-extension` (adds the fake-Meet match and the test hook).
 *   flow   : behaviour (onboarding, full sign -> sentence -> voice -> caption flow, keyboard-only use, network audit)
 *   visual : screenshots of screens 1-11 (committed baselines are macOS; regenerate with `pnpm update-visual`)
 *   store  : store listing images (`pnpm store-assets`)
 */
export default defineConfig({
  testDir: 'tests',
  timeout: 90_000,
  expect: {
    timeout: 15_000,
    toHaveScreenshot: { maxDiffPixelRatio: 0.002, animations: 'disabled', caret: 'hide' },
  },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  projects: [
    { name: 'flow', testMatch: /flow\/.*\.spec\.ts/ },
    { name: 'visual', testMatch: /visual\/.*\.spec\.ts/ },
    // Regenerates the Chrome Web Store screenshots and promo tiles into ../store (1280x800 / 440x280 / 1400x560).
    { name: 'store', testMatch: /store\/.*\.spec\.ts/ },
  ],
  webServer: [
    {
      // Mock API on the port the extension build points at (VITE_API_URL default).
      command: 'node ../apps/api/dist/server.js',
      url: 'http://localhost:8080/healthz',
      reuseExistingServer: !process.env.CI,
      env: {
        MOCK: '1',
        MOCK_LOW_CONFIDENCE_RATE: '0',
        PORT: '8080',
        ALLOWED_ORIGINS: '*',
        LOG_LEVEL: 'warn',
      },
    },
    {
      command: 'node ../tools/fake-meet/server.mjs',
      url: 'http://localhost:4173/',
      reuseExistingServer: !process.env.CI,
    },
  ],
});
