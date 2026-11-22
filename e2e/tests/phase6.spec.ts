import { expect, test } from '@playwright/test';
import { setUpBudget, signUpAndSkipTutorial, tab } from './helpers';

test.describe('phase 6: offline viewing', () => {
  test('with no connection the app opens with the last data, read-only, and says when it is from', async ({ page, context }) => {
    await signUpAndSkipTutorial(page);
    await setUpBudget(page);
    await tab(page, 'Expenses').click();
    await page.getByRole('button', { name: 'Add an expense' }).click();
    const f = page.getByRole('dialog', { name: 'Add expense' });
    await f.getByLabel('Amount').fill('42');
    await f.getByLabel('Category').selectOption({ label: 'Food' });
    await f.getByLabel(/What for/).fill('Falafel');
    await f.getByRole('button', { name: 'Add expense' }).click();
    await expect(page.locator('.list-item', { hasText: 'Falafel' })).toBeVisible();
    // Let the service worker take over and the saved copy be written (it is written about a second after changes).
    await page.waitForFunction(() => !!navigator.serviceWorker?.controller);
    await page.waitForTimeout(1500);

    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    await expect(page.getByText(/Showing data from/)).toBeVisible();
    await expect(page.locator('.list-item', { hasText: 'Falafel' })).toBeVisible(); // the Expenses list, from the saved copy
    await tab(page, 'Budget').click();
    await expect(page.getByText('Food').first()).toBeVisible();

    await context.setOffline(false);
    await expect(page.getByText(/Showing data from/)).toHaveCount(0, { timeout: 20_000 });
  });

  test('signing out removes the saved copy from the phone', async ({ page }) => {
    await signUpAndSkipTutorial(page);
    await setUpBudget(page);
    await page.waitForTimeout(1500);
    await tab(page, 'Home').click();
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    await page.waitForTimeout(1500);
    const saved = await page.evaluate(
      () =>
        new Promise<string>((resolve) => {
          const req = indexedDB.open('budget-me-cache', 1);
          req.onupgradeneeded = () => req.result.createObjectStore('client');
          req.onsuccess = () => {
            const get = req.result.transaction('client').objectStore('client').get('query-cache');
            get.onsuccess = () => resolve(JSON.stringify(get.result ?? null));
          };
        }),
    );
    expect(saved).not.toContain('Food');
  });
});
