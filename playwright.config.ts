import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  globalTeardown: './e2e/teardown.ts',
  use: {
    actionTimeout: 15_000,
    baseURL: 'http://127.0.0.1:4175',
    browserName: 'chromium',
    channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
    headless: true,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node e2e/server.mjs',
    url: 'http://127.0.0.1:4175/__health',
    reuseExistingServer: false,
    timeout: 15_000,
  },
});
