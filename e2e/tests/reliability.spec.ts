import { expect, test } from '@playwright/test';
import { signUpAndSkipTutorial, tab } from './helpers';

test.describe('0.6.0: crash screen, version and update prompt', () => {
  test('a screen that crashes shows "Something went wrong" with Reload, and reports it', async ({ page }) => {
    await signUpAndSkipTutorial(page);
    // Break the data the app draws from, so rendering throws.
    await page.route('**/api/state**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"categories":42}' }));
    const report = page.waitForRequest((r) => r.url().endsWith('/api/client-errors') && r.method() === 'POST');
    // Drop the offline copy, so the app really asks the server (and gets the broken data).
    await page.evaluate(() => new Promise((r) => { const d = indexedDB.deleteDatabase('budget-me-cache'); d.onsuccess = d.onerror = d.onblocked = () => r(null); }));
    await page.reload();

    const alert = page.getByRole('alert');
    await expect(alert.getByRole('heading', { name: 'Something went wrong' })).toBeVisible();
    await expect(alert).toContainText('Masrofy MK1 · Version 2.5.0');
    const body = (await report).postDataJSON();
    expect(body).toMatchObject({ kind: 'render', version: '2.5.0' });
    expect(body.message).toBeTruthy();

    // Fixed data + Reload = the app is back.
    await page.unroute('**/api/state**');
    await alert.getByRole('button', { name: 'Reload' }).click();
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  });

  test('GET /api/version is public', async ({ request }) => {
    const r = await request.get('/api/version');
    expect(r.ok()).toBe(true);
    expect(await r.json()).toEqual({ web: '2.5.0', api: '2.5.0', minNativeVersionCode: 0 });
  });

  test('when the server has a newer version, the app offers "Reload" (and "Later" hides it)', async ({ page }) => {
    await signUpAndSkipTutorial(page);
    await tab(page, 'Home').click();
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.route('**/api/version', (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '{"web":"9.9.9","api":"9.9.9","minNativeVersionCode":0}' }),
    );
    // The app checks when it comes back to the screen.
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    const bar = page.getByRole('status').filter({ hasText: 'A new version is ready.' });
    await expect(bar).toBeVisible();
    await bar.getByRole('button', { name: 'Later' }).click();
    await expect(bar).toHaveCount(0);

    await page.reload();
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(bar).toBeVisible();
    await page.unroute('**/api/version');
    await bar.getByRole('button', { name: 'Reload' }).click();
    await page.waitForLoadState('load');
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    await expect(bar).toHaveCount(0);
  });
});
