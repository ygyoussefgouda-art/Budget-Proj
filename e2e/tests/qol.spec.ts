import { expect, test, type Page } from '@playwright/test';
import { setUpBudget, sheet, signUpAndSkipTutorial, tab } from './helpers';

/** 1.2.0: log again, maths in amounts, icons, remembered filters, pull to refresh, merge repeats, rollover switch. */
async function addExpense(page: Page, amount: string, desc: string, category = 'Food') {
  await page.getByRole('button', { name: 'Add an expense' }).click();
  const f = sheet(page, 'Add expense');
  await f.getByLabel('Amount').fill(amount);
  await f.getByLabel('Category').selectOption({ label: category });
  await f.getByLabel(/What for/).fill(desc);
  await f.getByRole('button', { name: 'Add expense' }).click();
  await expect(f).toHaveCount(0);
}

test.describe('1.2.0 quality of life', () => {
  test.beforeEach(async ({ page }) => {
    await signUpAndSkipTutorial(page);
    await setUpBudget(page);
  });

  test('maths in the amount: 45+30 shows = 75 and saves 75; + − × ÷ keys appear while typing', async ({ page }) => {
    await tab(page, 'Expenses').click();
    await page.getByRole('button', { name: 'Add an expense' }).click();
    const f = sheet(page, 'Add expense');
    const amount = f.getByLabel('Amount');
    await amount.click();
    await amount.fill('45');
    await f.getByRole('button', { name: 'Plus' }).click();
    await expect(amount).toHaveValue('45+');
    await amount.pressSequentially('30');
    await expect(f.locator('.calc-result')).toHaveText('= 75 EGP');
    await f.getByLabel(/What for/).fill('Lunch for two');
    await expect(amount).toHaveValue('75'); // the sum is written out when you leave the field
    await f.getByRole('button', { name: 'Add expense' }).click();
    await expect(f).toHaveCount(0);
    await expect(page.locator('.list-item', { hasText: 'Lunch for two' })).toContainText('75 EGP');

    await page.getByRole('button', { name: 'Add an expense' }).click();
    const g = sheet(page, 'Add expense');
    await g.getByLabel('Amount').fill('10/0');
    await expect(g.locator('.calc-result')).toHaveText('Check the sum');
  });

  test('log again: an old expense copied to today in two taps', async ({ page }) => {
    await tab(page, 'Expenses').click();
    await addExpense(page, '12', 'Metro');
    await page.locator('.list-item', { hasText: 'Metro' }).locator('.list-main').click();
    const e = sheet(page, 'Edit expense');
    await e.getByRole('button', { name: 'Log again today' }).click();
    const copy = sheet(page, 'Add expense');
    await expect(copy.getByLabel('Amount')).toHaveValue('12');
    await expect(copy.getByLabel(/What for/)).toHaveValue('Metro');
    await copy.getByRole('button', { name: 'Add expense' }).click();
    // identical to the first one (same day): the usual check asks first
    await page.getByRole('alertdialog').getByRole('button', { name: 'Save anyway' }).click();
    await expect(copy).toHaveCount(0);
    await expect(page.locator('.list-item', { hasText: 'Metro' })).toHaveCount(2);
  });

  test('category icon and colour show in the lists', async ({ page }) => {
    await page.locator('.cat-row', { hasText: 'Food' }).locator('.budget-row').click();
    const c = sheet(page, 'Edit category');
    await c.getByRole('radio', { name: 'Food' }).click();
    await c.getByRole('radio', { name: 'Gold' }).click();
    await expect(c.getByRole('radio', { name: 'Food' })).toHaveAttribute('aria-checked', 'true');
    await c.getByRole('button', { name: 'Save' }).click();
    await expect(c).toHaveCount(0);
    await expect(page.locator('.cat-row', { hasText: 'Food' }).locator('.row-name .avatar svg')).toBeVisible();

    await tab(page, 'Expenses').click();
    await addExpense(page, '30', 'Falafel');
    const avatar = page.locator('.list-item', { hasText: 'Falafel' }).locator('.avatar');
    await expect(avatar.locator('svg')).toBeVisible();
    await expect(avatar).toHaveCSS('color', 'rgb(201, 141, 79)'); // gold #c98d4f
  });

  test('Expenses filters are still there after visiting another tab, and can be cleared', async ({ page }) => {
    await tab(page, 'Expenses').click();
    await page.getByRole('button', { name: 'All time' }).click();
    await page.getByLabel('Search expenses').fill('bus');
    await tab(page, 'Home').click();
    await tab(page, 'Expenses').click();
    await expect(page.getByRole('button', { name: 'All time' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByLabel('Search expenses')).toHaveValue('bus');
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page.getByRole('button', { name: 'This month' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByLabel('Search expenses')).toHaveValue('');
  });

  test('pull down at the top of a page reloads the data', async ({ page }) => {
    await tab(page, 'Home').click();
    const reload = page.waitForRequest((r) => r.url().includes('/api/state'));
    // A finger pulling down 150 px from the top of the page.
    await page.evaluate(async () => {
      const touch = (y: number) => new Touch({ identifier: 1, target: document.body, clientX: 180, clientY: y });
      const fire = (type: string, y: number) =>
        window.dispatchEvent(new TouchEvent(type, { touches: type === 'touchend' ? [] : [touch(y)], changedTouches: [touch(y)], bubbles: true }));
      fire('touchstart', 120);
      for (let y = 140; y <= 270; y += 26) fire('touchmove', y);
      await new Promise((r) => setTimeout(r, 50));
      fire('touchend', 270);
    });
    await reload;
    await expect(page.locator('.ptr')).toHaveCount(0); // the spinner goes away when done
  });

  test('add quick repeats together (off by default; on: Transport 10 + 10 = 20)', async ({ page }) => {
    await page.getByRole('button', { name: 'Add a spending category' }).click();
    const c = sheet(page, 'New category');
    await c.getByLabel('Name').fill('Transport');
    await c.getByRole('button', { name: 'Save' }).click();
    await expect(c).toHaveCount(0);

    await tab(page, 'Home').click();
    await tab(page, 'Settings').click();
    const merge = page.getByRole('switch', { name: /Add quick repeats together/ });
    await expect(merge).not.toBeChecked();
    await merge.check();
    await expect(merge).toBeChecked();

    await tab(page, 'Expenses').click();
    await addExpense(page, '10', 'Bus', 'Transport');
    await addExpense(page, '10', 'Bus', 'Transport');
    await expect(page.getByText('Added to your last Bus expense: now 20 EGP.')).toBeVisible();
    await expect(page.locator('.list-item', { hasText: 'Bus' })).toHaveCount(1);
    await expect(page.locator('.list-item', { hasText: 'Bus' })).toContainText('20 EGP');
  });

  test('carry over unspent budget: off by default, the switch is saved', async ({ page }) => {
    await tab(page, 'Home').click();
    await tab(page, 'Settings').click();
    const roll = page.getByRole('switch', { name: /Carry over unspent budget/ });
    await expect(roll).not.toBeChecked();
    await roll.check();
    await page.reload();
    await expect(page.getByRole('switch', { name: /Carry over unspent budget/ })).toBeChecked();
  });

  test('language switch reads English, عربي, System', async ({ page }) => {
    await tab(page, 'Home').click();
    await tab(page, 'Settings').click();
    const lang = page.getByRole('heading', { name: 'Language' }).locator('xpath=ancestor::section[1]').getByRole('tab');
    await expect(lang).toHaveText(['English', 'عربي', 'System']);
  });
});
