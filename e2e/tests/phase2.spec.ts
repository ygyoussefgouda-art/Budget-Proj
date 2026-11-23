import { expect, test, type Page } from '@playwright/test';
import { setUpBudget, sheet, signUpAndSkipTutorial, tab } from './helpers';

async function quickAdd(page: Page, amount: string, description: string, category: string) {
  await tab(page, 'Home').click();
  await page.getByRole('button', { name: 'New expense' }).click();
  const f = sheet(page, 'Quick add');
  await f.getByLabel('Amount').fill(amount);
  await f.getByLabel('Category').selectOption({ label: category });
  await f.getByLabel(/What for/).fill(description);
  await f.getByRole('button', { name: 'Add expense' }).click();
  await expect(f).toHaveCount(0);
}

test.describe('phase 2: budget alerts, reports, savings forecast', () => {
  test.beforeEach(async ({ page }) => {
    await signUpAndSkipTutorial(page);
  });

  test('a category turns amber at 80% and red when over, with a banner and a tab badge', async ({ page }) => {
    await setUpBudget(page); // Food: 1,500 EGP
    await quickAdd(page, '1250', 'Groceries', 'Food');

    const banner = page.locator('.alert-banner');
    await expect(banner).toContainText('1 category needs a look');
    await expect(banner).toContainText('Food: 83% of the budget used');
    await expect(banner).toHaveClass(/is-amber/);
    await expect(page.getByRole('link', { name: 'Budget, 1 budget alert' })).toBeVisible();

    await tab(page, 'Budget').click();
    await expect(page.locator('.cat-row', { hasText: 'Food' })).toContainText('Almost used up');

    await quickAdd(page, '300', 'Dinner out', 'Food');
    await expect(banner).toContainText('Food: over budget by 50 EGP');
    await expect(banner).toHaveClass(/is-red/);
    await tab(page, 'Budget').click();
    await expect(page.locator('.cat-row', { hasText: 'Food' })).toContainText('Over budget');
  });

  test('Reports compare this month with last month and show spending by weekday', async ({ page }) => {
    await setUpBudget(page);
    await quickAdd(page, '200', 'Snacks', 'Food');
    await tab(page, 'Home').click();
    await page.getByRole('button', { name: 'Reports' }).click();

    const compare = page.locator('.compare-card');
    await expect(compare.getByRole('heading', { name: 'Compared with last month' })).toBeVisible();
    await expect(compare.locator('.compare-row', { hasText: 'Food' })).toContainText('new'); // nothing last month
    await expect(compare.locator('.biggest')).toContainText('Food');

    await expect(page.getByRole('heading', { name: 'Spending by weekday' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Average spending per weekday' })).toBeVisible();
    await expect(page.getByText(/You spend the most on \w+: [\d,.]+ EGP on average\./)).toBeVisible();
    const weekdays = page.locator('.weekday-card');
    await weekdays.getByRole('button', { name: 'Last 3 months' }).click();
    await expect(weekdays.getByRole('button', { name: 'Last 3 months' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('a savings goal shows when it will be reached and warns when behind plan', async ({ page }) => {
    await tab(page, 'Savings').click();
    await page.getByRole('button', { name: 'Add a savings goal' }).click();
    const g = sheet(page, 'New savings goal');
    await g.getByLabel('Saving for').fill('Laptop');
    await g.getByLabel('Target amount').fill('10000');
    await g.getByLabel(/Planned per month/).fill('1000');
    await g.getByRole('button', { name: 'Save' }).click();
    await expect(g).toHaveCount(0);

    await page.locator('.list-item', { hasText: 'Laptop' }).locator('.list-row').click();
    await page.getByRole('button', { name: 'Deposit' }).first().click();
    const s = sheet(page, 'Add to savings');
    await s.getByLabel('Amount').fill('500');
    await s.getByRole('button', { name: 'Save' }).click();
    await expect(s).toHaveCount(0);

    const hero = page.locator('.hero');
    await expect(hero).toContainText("At this pace you'll reach Laptop in");
    await expect(hero).toContainText('Based on 500 EGP saved this month.');
    await expect(hero).toContainText('Behind plan: saving about 500 EGP a month, planned 1,000 EGP.');
  });
});
