import { defineConfig, devices } from '@playwright/test';

const ORIGIN = 'http://localhost:3100';

// One account and one shared database: specs cannot run side by side.
export default defineConfig({
  testDir: './e2e',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: ORIGIN, locale: 'id-ID', timezoneId: 'Asia/Jakarta', trace: 'retain-on-failure' },
  webServer: {
    command: 'node --env-file=e2e/.env.e2e .output/server/index.mjs',
    url: `${ORIGIN}/health`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: /responsive\.spec\.ts/ },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] }, testIgnore: /responsive\.spec\.ts/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /responsive\.spec\.ts/ },
  ],
});
