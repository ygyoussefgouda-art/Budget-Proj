import { expect, test } from '@playwright/test';
import { setUpBudget, sheet, signUpAndSkipTutorial, tab } from './helpers';

test.describe('2.3.0: thousands separators in amount fields', () => {
  test('typing 12500 shows 12,500 and saves 12,500', async ({ page }) => {
    await signUpAndSkipTutorial(page);
    await setUpBudget(page);
    await tab(page, 'Expenses').click();
    await page.getByRole('button', { name: 'Add an expense' }).click();
    const f = sheet(page, 'Add expense');
    const amount = f.getByLabel('Amount');
    await amount.pressSequentially('12500');
    await expect(amount).toHaveValue('12,500');
    await amount.pressSequentially('.5');
    await expect(amount).toHaveValue('12,500.5');
    await amount.press('Backspace');
    await amount.press('Backspace');
    await amount.press('Backspace'); // "12,50" → 1250
    await expect(amount).toHaveValue('1,250');
    await amount.fill('');
    await amount.pressSequentially('100000');
    await expect(amount).toHaveValue('100,000');
    await f.getByLabel(/What for/).fill('Laptop');
    await f.getByRole('button', { name: 'Add expense' }).click();
    await expect(f).toHaveCount(0);
    await expect(page.locator('.list-item', { hasText: 'Laptop' })).toContainText(/100,000\sEGP/);

    // A small amount with a decimal comma still works as before
    await page.getByRole('button', { name: 'Add an expense' }).click();
    const g = sheet(page, 'Add expense');
    await g.getByLabel('Amount').pressSequentially('12,50');
    await expect(g.getByLabel('Amount')).toHaveValue('12,50');
    await g.getByLabel(/What for/).fill('Juice');
    await g.getByRole('button', { name: 'Add expense' }).click();
    await expect(g).toHaveCount(0);
    await expect(page.locator('.list-item', { hasText: 'Juice' })).toContainText(/12\.50\sEGP/);
  });
});
