import { expect, test, type Page } from '@playwright/test';
import { setUpBudget, sheet, signUpAndSkipTutorial, tab } from './helpers';

/** Today in the browser's timezone (the tests run as Africa/Cairo). */
const todayInCairo = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });

async function quickAdd(page: Page, amount: string, description: string, category?: string) {
  await tab(page, 'Home').click();
  await page.getByRole('button', { name: 'New expense' }).click();
  const f = sheet(page, 'Quick add');
  await f.getByLabel('Amount').fill(amount);
  if (category) await f.getByLabel('Category').selectOption({ label: category });
  await f.getByLabel(/What for/).fill(description);
  await f.getByRole('button', { name: 'Add expense' }).click();
  await expect(f).toHaveCount(0);
}

test.describe('phase 1: quick add, daily allowance, undo, recurring, same as last month', () => {
  test.beforeEach(async ({ page }) => {
    await signUpAndSkipTutorial(page);
  });

  test('quick add from Home remembers the category and suggests descriptions', async ({ page }) => {
    await setUpBudget(page);
    await quickAdd(page, '45', 'Koshary', 'Uni');
    await expect(page.getByText('Koshary').first()).toBeVisible(); // in Recent transactions

    await page.getByRole('button', { name: 'New expense' }).click();
    const f = sheet(page, 'Quick add');
    await expect(f.getByLabel('Category').locator('option:checked')).toHaveText('Uni'); // last used
    await expect(f.getByText('Receipt (optional)')).toHaveCount(0); // the short form
    await expect(f.getByLabel('Date')).toHaveValue(todayInCairo());
    await f.getByRole('group', { name: 'Often used' }).getByRole('button', { name: 'Koshary' }).click();
    await expect(f.getByLabel(/What for/)).toHaveValue('Koshary');
  });

  test('a new account sees a first step on Home, never a false "Goal met"', async ({ page }) => {
    await tab(page, 'Home').click();
    await expect(page.getByRole('heading', { name: "Start with this month's income" })).toBeVisible();
    await expect(page.getByText('Goal met')).toHaveCount(0);
    await expect(page.getByText('Saved this month')).toHaveCount(0); // no wall of zero tiles
    await page.getByRole('button', { name: 'Set your income' }).click();
    const s = sheet(page, /Income & plans/);
    await s.getByLabel(/Income for/).fill('3000');
    await s.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Your budget left').locator('..')).toContainText('3,000 EGP');
    await tab(page, 'Budget').click();
    await expect(page.getByText('Goal met')).toHaveCount(0); // Savings / Loan rows with no plan say "No plan"
    await expect(page.getByText('No plan').first()).toBeVisible();
  });

  test('Home shows how much can be spent per day', async ({ page }) => {
    await setUpBudget(page);
    await tab(page, 'Home').click();
    await expect(page.getByText(/You can spend [\d,.]+ EGP a day until/)).toBeVisible();
  });

  test('deleting an expense is instant, and Undo brings it back', async ({ page }) => {
    await setUpBudget(page);
    await quickAdd(page, '20', 'Juice', 'Food');
    await tab(page, 'Expenses').click();
    const row = page.locator('.list-item', { hasText: 'Juice' });
    await row.getByRole('button', { name: 'Delete expense' }).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0); // no "are you sure?"
    await expect(row).toHaveCount(0);
    await page.locator('.toast', { hasText: 'Deleted' }).getByRole('button', { name: 'Undo' }).click();
    await expect(page.locator('.list-item', { hasText: 'Juice' })).toHaveCount(1);
    await expect(page.getByText('Brought back.')).toBeVisible();
  });

  test('a recurring expense comes due and is added once with one tap', async ({ page }) => {
    await setUpBudget(page);
    await tab(page, 'Expenses').click();
    await page.getByRole('button', { name: 'Recurring expenses', exact: true }).click();
    const s = sheet(page, 'Recurring expenses');
    await expect(s.getByText('No recurring expenses yet.')).toBeVisible();
    await s.getByRole('button', { name: 'Add a recurring expense' }).click();
    await s.getByLabel('Amount').fill('3000');
    await s.getByLabel('Category').selectOption({ label: 'Food' });
    await s.getByLabel(/What for/).fill('Rent');
    const day = Number(todayInCairo().slice(8, 10));
    await s.getByLabel('Every month on day').selectOption(String(day));
    await s.getByRole('button', { name: 'Add recurring expense' }).click();
    await expect(s.locator('.list-item', { hasText: 'Rent' })).toContainText('Next:');
    await page.keyboard.press('Escape');

    // It is due today: one tap adds it, and the Due card goes away
    const due = page.locator('.due-card');
    await expect(due).toContainText('Rent');
    await expect(due).toContainText('1 due');
    await due.getByRole('button', { name: /^Add Rent on / }).click();
    await expect(page.locator('.due-card')).toHaveCount(0);
    await expect(page.locator('.list-item', { hasText: 'Rent' })).toHaveCount(1);
    await expect(page.locator('.list-item', { hasText: 'Rent' })).toContainText('3,000 EGP');

    // Pause it from the list
    await page.getByRole('button', { name: 'Recurring expenses', exact: true }).click();
    await s.locator('.list-item', { hasText: 'Rent' }).locator('.list-main').click();
    await s.getByLabel(/^Paused/).check();
    await s.getByRole('button', { name: 'Save changes' }).click();
    await expect(s.locator('.list-item', { hasText: 'Rent' })).toContainText('Paused');
  });

  test('an empty month offers "Same as last month"', async ({ page }) => {
    // Open next month while this one is still empty, then fill in this month.
    await tab(page, 'Budget').click();
    await page.getByRole('button', { name: 'Next month' }).click();
    await expect(page.getByRole('button', { name: 'Same as last month' })).toHaveCount(0); // nothing to copy yet
    await page.getByRole('button', { name: 'Previous month' }).click();
    await setUpBudget(page);

    await page.getByRole('button', { name: 'Next month' }).click();
    await page.getByRole('button', { name: 'Same as last month' }).click();
    await expect(page.getByText('Budget copied.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Same as last month' })).toHaveCount(0);
    await expect(page.getByText('Monthly income').locator('..')).toContainText('5,000 EGP');
    await expect(page.locator('.cat-row', { hasText: 'Food' })).toContainText('1,500 EGP');
  });
});
