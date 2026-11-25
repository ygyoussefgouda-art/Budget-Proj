import { expect, test } from '@playwright/test';
import { PASSWORD, setUpBudget, sheet, signUpAndSkipTutorial, tab } from './helpers';

test.describe('0.6.1 safety fixes', () => {
  test('with no connection the app lock still asks for the PIN', async ({ page, context }) => {
    await signUpAndSkipTutorial(page);
    await setUpBudget(page);
    await tab(page, 'Home').click();
    await tab(page, 'Settings').click();
    await page.getByRole('button', { name: 'Set a PIN' }).click();
    const s = sheet(page, 'Set a PIN');
    await s.getByLabel('New PIN (4–6 digits)').fill('2468');
    await s.getByLabel('Repeat the PIN').fill('2468');
    await s.getByLabel('Lock the app').selectOption({ label: 'Right away' });
    await s.getByRole('button', { name: 'Turn on app lock' }).click();
    await expect(page.getByText('App lock is on.')).toBeVisible();
    await page.waitForFunction(() => !!navigator.serviceWorker?.controller);

    await context.setOffline(true);
    await page.reload();
    const lock = page.getByRole('dialog', { name: 'App locked' });
    await expect(lock).toBeVisible();
    // Nothing of the offline app (name, categories, queued expenses) behind the lock
    await expect(page.getByText(/You're offline/)).toHaveCount(0);
    for (const d of '2468') await lock.getByRole('button', { name: d, exact: true }).click();
    await expect(lock).toHaveCount(0);
    // Unlocked: the app opens from the saved copy (offline viewing, 0.6.4).
    await expect(page.getByText(/Showing data from/)).toBeVisible();
    await context.setOffline(false);
  });

  test('"Erase all data" asks for the password; a wrong one changes nothing', async ({ page }) => {
    await signUpAndSkipTutorial(page);
    await setUpBudget(page);
    await tab(page, 'Home').click();
    await tab(page, 'Settings').click();
    await page.getByRole('button', { name: 'Erase all data' }).click();
    const dlg = page.getByRole('alertdialog');
    await expect(dlg.getByRole('button', { name: 'Erase' })).toBeDisabled();
    await dlg.getByLabel('Your password').fill('not-my-password');
    await dlg.getByRole('button', { name: 'Erase' }).click();
    await expect(page.getByText('Your current password is not right.')).toBeVisible();
    await tab(page, 'Budget').click();
    await expect(page.getByText('Food').first()).toBeVisible(); // still there

    await tab(page, 'Home').click();
    await tab(page, 'Settings').click();
    await page.getByRole('button', { name: 'Erase all data' }).click();
    await dlg.getByLabel('Your password').fill(PASSWORD);
    await dlg.getByRole('button', { name: 'Erase' }).click();
    await expect(page.getByText('All data erased.')).toBeVisible();
  });

  test('"12,50" typed with a decimal comma is 12.50, not 1,250', async ({ page }) => {
    await signUpAndSkipTutorial(page);
    await setUpBudget(page);
    await tab(page, 'Expenses').click();
    await page.getByRole('button', { name: 'Add an expense' }).click();
    const s = sheet(page, 'Add expense');
    await s.getByLabel('Amount').fill('12,50');
    await s.getByLabel('Category').selectOption({ label: 'Food' });
    await s.getByLabel(/What for/).fill('Juice');
    await s.getByRole('button', { name: 'Add expense' }).click();
    await expect(s).toHaveCount(0);
    const row = page.locator('.list-item', { hasText: 'Juice' });
    await expect(row).toContainText('12.50');
    await expect(row).not.toContainText('1,250');
  });
});
