import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { confirmDialog, setUpBudget, sheet, signUpAndSkipTutorial, tab } from './helpers';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

test.describe('budget, expenses and receipts', () => {
  test.beforeEach(async ({ page }) => {
    await signUpAndSkipTutorial(page);
    await setUpBudget(page);
  });

  test('budget numbers add up on Budget and Home', async ({ page }) => {
    // Planned: Food 1,500 + Uni 1,200 + savings 1,000 + loans 500 = 4,200 of 5,000
    await expect(page.getByText('Planned total').locator('..')).toContainText('4,200 EGP');
    await expect(page.getByText('Unallocated income').locator('..')).toContainText('800 EGP');
    await expect(page.getByText('Money left').locator('..')).toContainText('5,000 EGP');

    await tab(page, 'Home').click();
    await expect(page.getByText('Your budget left').locator('..')).toContainText('5,000 EGP');
    await expect(page.getByText('800 EGP of income is not planned yet.')).toBeVisible();
  });

  test('add an expense with a receipt, view it, edit it, delete it', async ({ page }) => {
    await tab(page, 'Expenses').click();
    await page.getByRole('button', { name: 'Add an expense' }).click();
    const f = sheet(page, 'Add expense');
    await f.getByLabel('Amount').fill('55');
    await f.getByLabel('Category').selectOption({ label: 'Food' });
    await f.getByLabel(/What for/).fill('Koshary');
    await f.locator('input[type=file]').setInputFiles(path.join(fixtures, 'receipt.png'));
    await expect(f.getByText('receipt.png')).toBeVisible();
    await f.getByRole('button', { name: 'Add expense' }).click();
    await expect(f).toHaveCount(0);

    const row = page.locator('.list-item', { hasText: 'Koshary' });
    await expect(row).toContainText('55 EGP');
    await expect(page.getByText('1 expense', { exact: true })).toBeVisible();

    // The receipt was stored and comes back as an image
    await row.getByRole('button', { name: 'View receipt' }).click();
    const viewer = sheet(page, 'Receipt');
    const img = viewer.getByRole('img', { name: 'Receipt' });
    await expect(img).toBeVisible();
    expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(100);
    await page.keyboard.press('Escape');

    // Budget usage reflects it
    await tab(page, 'Home').click();
    await expect(page.locator('.budget-row', { hasText: 'Food' })).toContainText('55 EGP of 1,500 EGP');
    await expect(page.getByText('Your budget left').locator('..')).toContainText('4,945 EGP');

    // Edit: change the amount and remove the receipt
    await tab(page, 'Expenses').click();
    await page.locator('.list-item', { hasText: 'Koshary' }).locator('.list-main').click();
    const e = sheet(page, 'Edit expense');
    await expect(e.getByText('Receipt attached')).toBeVisible();
    await e.getByLabel('Amount').fill('60');
    await e.getByRole('button', { name: 'Remove' }).click();
    await e.getByRole('button', { name: 'Save changes' }).click();
    await expect(e).toHaveCount(0);
    const edited = page.locator('.list-item', { hasText: 'Koshary' });
    await expect(edited).toContainText('60 EGP');
    await expect(edited.getByRole('button', { name: 'View receipt' })).toHaveCount(0);

    // Delete
    await edited.getByRole('button', { name: 'Delete expense' }).click();
    await confirmDialog(page, 'Delete');
    await expect(page.locator('.list-item', { hasText: 'Koshary' })).toHaveCount(0);
  });

  test('receipts that are not photos/PDFs are refused', async ({ page }) => {
    await tab(page, 'Expenses').click();
    await page.getByRole('button', { name: 'Add an expense' }).click();
    const f = sheet(page, 'Add expense');
    await f.locator('input[type=file]').setInputFiles(path.join(fixtures, 'not-a-receipt.txt'));
    await expect(f.getByText('Receipts must be a photo or a PDF.')).toBeVisible();
  });

  test('duplicate expense asks before saving twice', async ({ page }) => {
    await tab(page, 'Expenses').click();
    for (let i = 0; i < 2; i++) {
      await page.getByRole('button', { name: 'Add an expense' }).click();
      const f = sheet(page, 'Add expense');
      await f.getByLabel('Amount').fill('20');
      await f.getByLabel(/What for/).fill('Bus');
      await f.getByRole('button', { name: 'Add expense' }).click();
      if (i === 1) await confirmDialog(page, 'Save anyway');
      await expect(f).toHaveCount(0);
    }
    await expect(page.locator('.list-item', { hasText: 'Bus' })).toHaveCount(2);
  });

  test('search and category filter', async ({ page }) => {
    await tab(page, 'Expenses').click();
    for (const [amount, desc, cat] of [
      ['30', 'Lunch', 'Food'],
      ['100', 'Train', 'Uni'],
    ]) {
      await page.getByRole('button', { name: 'Add an expense' }).click();
      const f = sheet(page, 'Add expense');
      await f.getByLabel('Amount').fill(amount);
      await f.getByLabel('Category').selectOption({ label: cat });
      await f.getByLabel(/What for/).fill(desc);
      await f.getByRole('button', { name: 'Add expense' }).click();
      await expect(f).toHaveCount(0);
    }
    await page.getByLabel('Search expenses').fill('train');
    await expect(page.locator('.list-item')).toHaveCount(1);
    await expect(page.locator('.list-item')).toContainText('Train');
    await page.getByLabel('Clear search').click();
    await page.locator('.chips').getByRole('button', { name: 'Food' }).click();
    await expect(page.locator('.list-item')).toHaveCount(1);
    await expect(page.locator('.list-item')).toContainText('Lunch');
  });

  test('a category with expenses cannot be removed', async ({ page }) => {
    await tab(page, 'Expenses').click();
    await page.getByRole('button', { name: 'Add an expense' }).click();
    const f = sheet(page, 'Add expense');
    await f.getByLabel('Amount').fill('10');
    await f.getByRole('button', { name: 'Add expense' }).click();
    await expect(f).toHaveCount(0);
    await tab(page, 'Budget').click();
    await page.getByRole('button', { name: 'Remove Food' }).click();
    await confirmDialog(page, 'Remove');
    await expect(page.getByText(/has 1 expense/)).toBeVisible();
  });
});

test.describe('savings and loans', () => {
  test.beforeEach(async ({ page }) => {
    await signUpAndSkipTutorial(page);
  });

  test('savings goal: deposit, refuse over-withdrawal, delete', async ({ page }) => {
    await tab(page, 'Savings').click();
    await page.getByRole('button', { name: 'Add a savings goal' }).click();
    const g = sheet(page, 'New savings goal');
    await g.getByLabel('Saving for').fill('Laptop');
    await g.getByLabel('Target amount').fill('10000');
    await g.getByLabel(/Planned per month/).fill('1000');
    await g.getByRole('button', { name: 'Save' }).click();
    await expect(g).toHaveCount(0);
    await expect(page.locator('.list-item', { hasText: 'Laptop' })).toContainText('About 10 months at 1,000 EGP a month');

    await page.locator('.list-item', { hasText: 'Laptop' }).locator('.list-row').click();
    await page.getByRole('button', { name: 'Deposit' }).first().click();
    let s = sheet(page, 'Add to savings');
    await s.getByLabel('Amount').fill('2500');
    await s.getByRole('button', { name: 'Save' }).click();
    await expect(s).toHaveCount(0);
    await expect(page.locator('.hero')).toContainText('2,500 EGP');
    await expect(page.locator('.hero')).toContainText('25% there');

    await page.getByRole('button', { name: 'Withdraw', exact: true }).click();
    s = sheet(page, 'Add to savings');
    await s.getByLabel('Amount').fill('9999');
    await s.getByRole('button', { name: 'Save' }).click();
    await expect(s.getByText(/cannot withdraw more than the balance/)).toBeVisible();
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Delete goal' }).click();
    await confirmDialog(page, 'Delete');
    await expect(page).toHaveURL(/\/savings$/);
    await expect(page.getByText(/No savings goals yet/)).toBeVisible();
  });

  test('loans: borrow, over-repayment warning, rename and remove a person', async ({ page }) => {
    await tab(page, 'Loans').click();
    await page.getByRole('button', { name: 'Add money you borrowed' }).click();
    let l = sheet(page, 'Add loan entry');
    await l.getByLabel('Lender').fill('Ahmed');
    await l.getByLabel('Amount').fill('300');
    await l.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(l).toHaveCount(0);
    await expect(page.locator('.hero')).toContainText('300 EGP');

    // Repay more than owed: the app warns first
    await page.getByRole('button', { name: 'Add a loan entry' }).click();
    l = sheet(page, 'Add loan entry');
    await l.getByRole('tab', { name: 'I paid back' }).click();
    await l.getByLabel('Lender').fill('Ahmed');
    await l.getByLabel('Amount').fill('500');
    await l.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByRole('alertdialog')).toContainText('more than the outstanding 300');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();
    await l.getByLabel('Amount').fill('100');
    await l.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(l).toHaveCount(0);
    await expect(page.locator('.hero')).toContainText('200 EGP');

    // Rename (fixes every entry)
    await page.locator('.list-item', { hasText: 'Ahmed' }).locator('.list-row').click();
    const p = sheet(page, 'Ahmed');
    await p.getByLabel('Name').fill('Ahmed Ali');
    await p.getByRole('button', { name: 'Save name' }).click();
    await expect(page.locator('.list-item', { hasText: 'Ahmed Ali' }).first()).toBeVisible();
    await expect(page.getByText('Paid back · Ahmed Ali')).toBeVisible();

    // Remove the person and all their entries
    await page.getByRole('button', { name: 'Remove Ahmed Ali' }).click();
    await confirmDialog(page, 'Remove');
    await expect(page.getByText('You have not borrowed anything.')).toBeVisible();
    await expect(page.locator('.hero')).toContainText('0 EGP');
  });
});
