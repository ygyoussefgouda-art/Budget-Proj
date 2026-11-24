import { expect, test } from '@playwright/test';
import { sheet, signUpAndSkipTutorial, tab } from './helpers';

// The E2E server runs with STARTER_CATEGORIES=false, so this account starts empty: the worst case.
test.describe('2.1.0: a new account can log its first expense', () => {
  test('no categories yet: make one inside Add expense, then log it (dated Today)', async ({ page }) => {
    await signUpAndSkipTutorial(page);
    await tab(page, 'Home').click();
    await page.getByRole('button', { name: 'New expense' }).click();
    const f = sheet(page, 'Quick add');
    await expect(f.getByText('Name your first spending category')).toBeVisible();
    await f.getByLabel('New category name').fill('Coffee');
    await f.getByRole('button', { name: 'Add', exact: true }).click();

    await expect(f.getByLabel('Category').locator('option:checked')).toHaveText('Coffee');
    await expect(f.getByRole('button', { name: 'Today' })).toHaveAttribute('aria-pressed', 'true');
    await f.getByLabel('Amount').fill('35');
    await f.getByRole('button', { name: 'Add expense' }).click();
    await expect(f).toHaveCount(0);
    await expect(page.locator('.txn', { hasText: 'Coffee' })).toContainText('35 EGP');

    // Another one from the picker, next to the existing list
    await page.getByRole('button', { name: 'New expense' }).click();
    await f.getByRole('button', { name: '+ New category' }).click();
    await f.getByLabel('New category name').fill('Transport');
    await f.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(f.getByLabel('Category').locator('option:checked')).toHaveText('Transport');
    await f.getByRole('button', { name: 'Yesterday' }).click();
    await expect(f.getByRole('button', { name: 'Yesterday' })).toHaveAttribute('aria-pressed', 'true');
  });
});
