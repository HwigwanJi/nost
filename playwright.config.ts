import { defineConfig } from '@playwright/test';

// Playwright Electron smoke tests live at the repo root because they
// drive the whole app (main + renderer), not just the frontend bundle.
// Renderer must be built (`npm run build:frontend`) before running.
export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: process.env.CI ? 'list' : [['list'], ['html', { open: 'never' }]],
  use: {
    trace: 'retain-on-failure',
  },
});
