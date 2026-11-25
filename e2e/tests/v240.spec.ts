import { expect, test } from '@playwright/test';
import { setUpBudget, sheet, signUpAndSkipTutorial, tab } from './helpers';

test.describe('2.4.0: critique fixes', () => {
  test.beforeEach(async ({ page }) => {
    await signUpAndSkipTutorial(page);
    await setUpBudget(page); // income 5,000; Food 1,500
  });

  test('the centre + opens Add expense right where you are; a refused save says why, on screen', async ({ page }) => {
    await tab(page, 'Expenses').click();
    await page.getByRole('button', { name: 'New expense' }).click();
    const f = sheet(page, 'Add expense');
    await expect(f).toBeVisible();
    await expect(page).toHaveURL(/\/expenses$/); // no jump to Home

    await f.getByRole('button', { name: 'Add expense' }).click(); // no amount yet
    const err = f.getByRole('alert');
    await expect(err).toHaveText('Enter an amount greater than 0.');
    const box = (await err.boundingBox())!;
    const vh = page.viewportSize()!.height;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(vh); // visible without scrolling
  });

  test('typing an amount says what it does to the category and the month before saving', async ({ page }) => {
    await page.getByRole('button', { name: 'New expense' }).click();
    const f = sheet(page, 'Add expense');
    await f.getByLabel('Category').selectOption({ label: 'Food' });
    await f.getByLabel('Amount').fill('400');
    await expect(f.locator('.impact-line')).toContainText(/Food has 1,100\sEGP left/);
    await f.getByLabel('Amount').fill('2000');
    await expect(f.locator('.impact-line')).toContainText(/Food is 500\sEGP over budget/);
    await expect(f.locator('.impact-line')).toHaveClass(/is-over/);
  });

  test('the rarer fields fold under More details', async ({ page }) => {
    await page.getByRole('button', { name: 'New expense' }).click();
    const f = sheet(page, 'Add expense');
    await expect(f.getByLabel('Tags (optional)')).toHaveCount(0);
    await f.getByRole('button', { name: /More details/ }).click();
    await expect(f.getByLabel('Tags (optional)')).toBeVisible();
    await expect(f.getByText('Split with someone')).toBeVisible();
    await expect(f.getByText('Paid in another currency')).toBeVisible();
  });

  test('2.4.1: a sheet can be pulled down by its handle to close; a short pull springs back', async ({ page }) => {
    await page.getByRole('button', { name: 'New expense' }).click();
    const f = sheet(page, 'Add expense');
    const handle = f.getByRole('button', { name: 'Close' });
    const box = (await handle.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    // A slow, short pull: springs back
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 40, { steps: 20 });
    await page.waitForTimeout(400);
    await page.mouse.up();
    await expect(f).toBeVisible();
    // Pulled far enough: closes
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 200, { steps: 20 });
    await page.mouse.up();
    await expect(f).toHaveCount(0);
    // A tap on the handle closes too
    await page.getByRole('button', { name: 'New expense' }).click();
    await sheet(page, 'Add expense').getByRole('button', { name: 'Close' }).click();
    await expect(sheet(page, 'Add expense')).toHaveCount(0);
  });

  test('Arabic writes the currency as ج.م', async ({ page }) => {
    await tab(page, 'Settings').click();
    await page.getByRole('tab', { name: 'عربي' }).click();
    await page.getByRole('navigation').getByRole('link').first().click(); // Home (الرئيسية)
    await expect(page.locator('.hero-value')).toContainText('ج.م');
    await expect(page.locator('.hero-value')).not.toContainText('EGP');
  });
});
