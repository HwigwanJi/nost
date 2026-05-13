/**
 * Smoke test — does the app launch + does the renderer mount?
 *
 * This is the cheapest possible regression net. If the bundle has a
 * syntax error, the IPC contract drift breaks preload, or an import
 * chain blows up, this test fails. Doesn't validate behaviour, just
 * "does it open without exploding."
 *
 * Renderer must be built first: `npm run build:frontend`.
 *
 * The app boot creates two windows in sequence:
 *   1. Splash (data: URL with the loading logo)
 *   2. Main (file:// URL with index.html — the actual launcher)
 * We wait for the main one; the splash exists for ~1 second until
 * renderer-ready IPC arrives, but it doesn't have #root so testing
 * against it would time out.
 */

import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';

test('app launches and renderer mounts', async () => {
  const electronApp = await electron.launch({
    args: [path.join(__dirname, '..', 'main.js')],
    timeout: 30_000,
    env: {
      ...process.env,
      NODE_ENV: 'test',
    },
  });

  // Wait for the index.html-bearing window (the main launcher).
  // First-fired event might be the splash; we filter by URL.
  const mainWindow = await electronApp.waitForEvent('window', {
    predicate: (w) => /index\.html/.test(w.url()),
    timeout: 25_000,
  });

  await mainWindow.waitForLoadState('domcontentloaded');

  // React mounted = #root has children. Empty/unmounted bundle
  // would leave it as `<div id="root"></div>`.
  await expect(mainWindow.locator('#root')).not.toBeEmpty({ timeout: 15_000 });

  await electronApp.close();
});
