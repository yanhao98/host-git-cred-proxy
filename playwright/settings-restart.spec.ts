import { execSync } from 'node:child_process';

import { expect, test } from 'playwright/test';

const ROOT_URL = 'http://127.0.0.1:18765';
const RESTART_URL = 'http://127.0.0.1:18766';
const DEFAULT_PUBLIC_URL = 'http://host.docker.internal:18765';

test.describe('settings restart flow', () => {
  test.beforeAll(() => {
    execSync('bun host/src/index.ts start', { stdio: 'inherit' });
  });

  test.afterAll(() => {
    try {
      execSync('bun host/src/index.ts stop', { stdio: 'inherit' });
    } catch {}
  });

  test('saves, restarts, validates locally, and rotates token safely', async ({ page }) => {
    test.setTimeout(90_000);

    await page.goto(ROOT_URL);
    await expect(page.getByTestId('app-shell')).toBeVisible();

    await page.getByTestId('nav-settings').click();
    await expect(page.getByTestId('settings-port')).toBeVisible();

    await page.getByTestId('settings-port').fill('18766');
    await page.getByTestId('settings-save').click();

    await expect(page.getByTestId('save-status')).toContainText('Restart required');
    await expect(page.getByTestId('save-next-panel-url')).toContainText(RESTART_URL);

    await page.getByTestId('settings-restart').click();
    await expect(page.getByTestId('restart-banner')).toBeVisible();
    await page.waitForURL(`${RESTART_URL}/**`, { timeout: 20_000 });
    await expect(page.getByTestId('app-shell')).toBeVisible();

    await page.getByTestId('nav-settings').click();
    await page.getByTestId('settings-public-url').fill('ftp://bad');
    await page.getByTestId('settings-save').click();
    await expect(page.getByTestId('save-status')).toContainText('Public URL must start with http:// or https://.');

    await page.getByTestId('token-rotate').click();
    await expect(page.getByTestId('rotate-status')).toContainText('Token rotated successfully');

    await page.getByTestId('settings-public-url').fill(DEFAULT_PUBLIC_URL);
    await page.getByTestId('settings-port').fill('18765');
    await page.getByTestId('settings-save').click();
    await expect(page.getByTestId('save-status')).toContainText('Restart required');

    await page.getByTestId('settings-restart').click();
    await expect(page.getByTestId('restart-banner')).toBeVisible();
    await page.waitForURL(`${ROOT_URL}/**`, { timeout: 20_000 });
    await expect(page.getByTestId('app-shell')).toBeVisible();
  });
});
