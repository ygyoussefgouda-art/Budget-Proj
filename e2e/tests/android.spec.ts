import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { signUpAndSkipTutorial, tab } from './helpers';

// The E2E server has a fake release in e2e/fixtures/downloads/android (latest.json + a tiny APK).
test.describe('Android app download (browser side)', () => {
  test('Settings offers "Get the Android app" with version, guide and a working download', async ({ page }) => {
    await signUpAndSkipTutorial(page);
    await tab(page, 'Home').click();
    await page.getByRole('button', { name: 'Settings' }).click();
    const card = page.locator('.card', { has: page.getByRole('heading', { name: 'Get the Android app' }) });
    await expect(card).toContainText('Version 0.6.5');
    await expect(card).toContainText('Open the file. If Android asks, allow your browser to install unknown apps.');
    // Native-only cards are not shown in a browser
    await expect(page.getByRole('heading', { name: 'App updates' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Reminders' })).toHaveCount(0);

    const download = page.waitForEvent('download');
    await card.getByRole('link', { name: 'Download' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('budget-me-0.6.5.apk');
    const latest = await (await page.request.get('/api/app/android/latest')).json();
    const body = await (await page.request.get(latest.downloadUrl)).body();
    expect(createHash('sha256').update(body).digest('hex')).toBe(latest.sha256);
  });

  test('the sign-in screen links to the app; /download/android is a short link to the newest APK', async ({ page, request }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Get the Android app' })).toHaveAttribute('href', '/api/app/android/apk/budget-me-0.6.5.apk');
    const r = await request.get('/download/android', { maxRedirects: 0 });
    expect(r.status()).toBe(302);
    expect(r.headers()['location']).toBe('/api/app/android/apk/budget-me-0.6.5.apk');
  });
});

test.describe('in an Android phone browser', () => {
  // The phone profile is already an Android browser; start without the answer the config pre-fills.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('the app is offered once before sign-in; "Continue on the website" goes to sign-in and is remembered', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Do you want to download the Masrofy app for a better experience?' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Download the app' })).toHaveAttribute('href', '/api/app/android/apk/budget-me-0.6.5.apk');
    await page.getByRole('button', { name: 'Continue on the website' }).click();
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: /download the Masrofy app/ })).toHaveCount(0);
  });
});
