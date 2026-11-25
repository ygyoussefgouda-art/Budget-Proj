import { expect, test } from '@playwright/test';
import { setUpBudget, sheet, signUpAndSkipTutorial, tab } from './helpers';

test.describe('2.2.0: time on expenses, alerts open their cause, extra income, Settings under More', () => {
  test.beforeEach(async ({ page }) => {
    await signUpAndSkipTutorial(page);
  });

  test('an expense has a time: filled in with now, can be changed, shown in the list', async ({ page }) => {
    await setUpBudget(page);
    await tab(page, 'Expenses').click();
    await page.getByRole('button', { name: 'Add an expense' }).click();
    const f = sheet(page, 'Add expense');
    const time = f.locator('input[type=time]');
    await expect(time).toHaveValue(/^\d{2}:\d{2}$/); // the phone's clock now
    await f.getByLabel('Amount').fill('40');
    await f.getByLabel(/What for/).fill('Breakfast');
    await time.fill('09:30');
    await f.getByRole('button', { name: 'Add expense' }).click();
    await expect(f).toHaveCount(0);
    const row = page.locator('.list-item', { hasText: 'Breakfast' });
    await expect(row).toContainText(/9:30\sam/i);

    // Editing keeps it, and it can be changed
    await row.locator('.list-main').click();
    const e = sheet(page, 'Edit expense');
    await expect(e.locator('input[type=time]')).toHaveValue('09:30');
    await e.locator('input[type=time]').fill('21:05');
    await e.getByRole('button', { name: 'Save changes' }).click();
    await expect(e).toHaveCount(0);
    await expect(row).toContainText(/9:05\spm/i);
  });

  test('tapping a budget alert opens that category’s expenses this month', async ({ page }) => {
    await setUpBudget(page); // Food: 1,500 EGP
    await tab(page, 'Expenses').click();
    await page.getByRole('button', { name: 'Add an expense' }).click();
    const f = sheet(page, 'Add expense');
    await f.getByLabel('Amount').fill('1400');
    await f.getByLabel('Category').selectOption({ label: 'Food' });
    await f.getByLabel(/What for/).fill('Groceries');
    await f.getByRole('button', { name: 'Add expense' }).click();
    await expect(f).toHaveCount(0);
    // Something in another category, so the filter is visible in the list
    await page.getByRole('button', { name: 'Add an expense' }).click();
    const g = sheet(page, 'Add expense');
    await g.getByLabel('Amount').fill('50');
    await g.getByLabel('Category').selectOption({ label: 'Uni' });
    await g.getByLabel(/What for/).fill('Bus to uni');
    await g.getByRole('button', { name: 'Add expense' }).click();
    await expect(g).toHaveCount(0);

    await tab(page, 'Home').click();
    await page.locator('.alert-banner').getByRole('button', { name: /Food: 93% of the budget used/ }).click();
    await expect(page).toHaveURL(/\/expenses$/);
    await expect(page.getByRole('button', { name: 'Food', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'This month' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.list-item', { hasText: 'Groceries' })).toHaveCount(1);
    await expect(page.locator('.list-item', { hasText: 'Bus to uni' })).toHaveCount(0);
  });

  test('2.2.1: a read alert stops looking new; reaching the next level makes it new again', async ({ page }) => {
    await setUpBudget(page); // Food: 1,500 EGP
    const add = async (amount: string, what: string) => {
      await tab(page, 'Expenses').click();
      await page.getByRole('button', { name: 'Add an expense' }).click();
      const f = sheet(page, 'Add expense');
      await f.getByLabel('Amount').fill(amount);
      await f.getByLabel('Category').selectOption({ label: 'Food' });
      await f.getByLabel(/What for/).fill(what);
      await f.getByRole('button', { name: 'Add expense' }).click();
      await expect(f).toHaveCount(0);
    };
    const banner = page.locator('.alert-banner');
    const badge = page.getByRole('link', { name: 'Budget, 1 budget alert' });

    await add('1300', 'Groceries'); // 86%
    await tab(page, 'Home').click();
    await expect(banner).toHaveClass(/is-amber/);
    await expect(badge).toBeVisible();
    // Reading it (here: "Mark as read") makes it quiet and clears the badge
    await banner.getByRole('button', { name: 'Mark as read' }).click();
    await expect(banner).toHaveClass(/is-read/);
    await expect(page.getByRole('link', { name: 'Budget', exact: true })).toBeVisible();
    await expect(banner.getByRole('button', { name: 'Mark as read' })).toHaveCount(0);
    // Still read after a reload
    await page.reload();
    await expect(page.locator('.alert-banner')).toHaveClass(/is-read/);

    // Going over budget is new: colour and badge come back; opening Budget reads it
    await add('300', 'Dinner out');
    await tab(page, 'Home').click();
    await expect(banner).toHaveClass(/is-red/);
    await expect(badge).toBeVisible();
    await tab(page, 'Budget').click();
    await expect(page.getByRole('link', { name: 'Budget', exact: true })).toBeVisible();
    await tab(page, 'Home').click();
    await expect(banner).toHaveClass(/is-read/);
  });

  test('extra income adds to the month, shows in recent activity, and can be deleted with Undo', async ({ page }) => {
    await setUpBudget(page); // income 5,000
    await tab(page, 'Home').click();
    await page.getByRole('group', { name: 'Quick actions' }).getByRole('button', { name: 'Income' }).click();
    const s = sheet(page, /^Income · /);
    await expect(s.getByRole('button', { name: /Monthly income/ })).toContainText(/5,000\sEGP/);
    await s.getByRole('button', { name: 'Add extra income' }).click();
    await s.getByLabel('Amount').fill('1200');
    await s.getByLabel(/What was it/).fill('Freelance logo');
    await s.getByRole('button', { name: 'Add extra income' }).click();
    await expect(s.locator('.list-item', { hasText: 'Freelance logo' })).toContainText(/\+1,200\sEGP/);
    await expect(s.locator('.income-total')).toContainText(/6,200\sEGP/);
    await page.keyboard.press('Escape');

    // The band counts it, and says how much of the income is extra
    const band = page.getByText('Your budget left').locator('..');
    await expect(band).toContainText(/6,200\sEGP/);
    await expect(band).toContainText(/incl\.\s1,200\sEGP\sextra/);
    await expect(page.locator('.txn', { hasText: 'Freelance logo' })).toContainText(/\+1,200\sEGP/);

    // The monthly income line still opens the usual form
    await page.getByRole('group', { name: 'Quick actions' }).getByRole('button', { name: 'Income' }).click();
    await s.getByRole('button', { name: /Monthly income/ }).click();
    await expect(sheet(page, /Income & plans/)).toBeVisible();
    await page.keyboard.press('Escape');

    // Delete, then Undo brings it back
    await page.getByRole('group', { name: 'Quick actions' }).getByRole('button', { name: 'Income' }).click();
    await s.getByRole('button', { name: 'Delete extra income' }).click();
    await expect(s.locator('.list-item', { hasText: 'Freelance logo' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(s.locator('.list-item', { hasText: 'Freelance logo' })).toHaveCount(1);
  });

  test('Settings is under More, not on Home', async ({ page }) => {
    await tab(page, 'Home').click();
    await expect(page.getByRole('button', { name: 'Settings' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Reports' })).toBeVisible();
    await tab(page, 'Settings').click();
    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  });
});
