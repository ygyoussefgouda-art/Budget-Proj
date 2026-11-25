import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { setUpBudget, sheet, signUpAndSkipTutorial, tab } from './helpers';

async function openAdd(page: Page) {
  await tab(page, 'Expenses').click();
  await page.getByRole('button', { name: 'Add an expense' }).click();
  return sheet(page, 'Add expense');
}

test.describe('phase 3: tags, split, foreign currency, export', () => {
  test.beforeEach(async ({ page }) => {
    await signUpAndSkipTutorial(page);
    await setUpBudget(page);
  });

  test('tags: add, show, filter, search; Reports breaks spending down by tag', async ({ page }) => {
    let f = await openAdd(page);
    await f.getByLabel('Amount').fill('120');
    await f.getByLabel(/What for/).fill('Pizza');
    await f.getByRole('button', { name: /More details/ }).click(); // 2.4.0: tags, split, receipt, currency fold away
    await f.getByLabel('Tags (optional)').fill('#Trip friends');
    await f.getByRole('button', { name: 'Add expense' }).click();
    await expect(f).toHaveCount(0);
    f = await openAdd(page);
    await f.getByLabel('Amount').fill('30');
    await f.getByLabel(/What for/).fill('Bread');
    // tags used before are offered as chips
    await f.getByRole('button', { name: /More details/ }).click();
    await f.getByRole('group', { name: 'Your tags' }).getByRole('button', { name: '#trip' }).click();
    await expect(f.getByLabel('Tags (optional)')).toHaveValue('#trip');
    await f.getByLabel('Tags (optional)').fill('#home');
    await f.getByRole('button', { name: 'Add expense' }).click();
    await expect(f).toHaveCount(0);

    const pizza = page.locator('.list-item', { hasText: 'Pizza' });
    await expect(pizza.locator('.tag')).toHaveText(['#trip', '#friends']);
    await page.getByRole('group', { name: 'Tags' }).getByRole('button', { name: '#trip' }).click();
    await expect(page.locator('.list-item')).toHaveCount(1);
    await page.getByRole('group', { name: 'Tags' }).getByRole('button', { name: 'All tags' }).click();
    await page.getByLabel('Search expenses').fill('friends');
    await expect(page.locator('.list-item')).toHaveCount(1);
    await expect(page.locator('.list-item')).toContainText('Pizza');

    await tab(page, 'Home').click();
    await page.getByRole('button', { name: 'Reports' }).click();
    const tags = page.locator('.tags-card');
    await expect(tags.locator('.tag-row', { hasText: '#trip' })).toContainText('120 EGP');
    await expect(tags.locator('.tag-row', { hasText: '#home' })).toContainText('30 EGP');
    await expect(tags).toContainText('Without a tag: 0 EGP');
  });

  test('split a bill: my share is the expense, their share lands in "Owed to me" and follows edits', async ({ page }) => {
    const f = await openAdd(page);
    await f.getByLabel('Amount').fill('300');
    await f.getByLabel(/What for/).fill('Dinner');
    await f.getByRole('button', { name: /More details/ }).click(); // 2.4.0: tags, split, receipt, currency fold away
    await f.getByText('Split with someone').click();
    await f.getByLabel('Split with', { exact: true }).fill('Omar');
    await expect(f.getByText('You pay 150 EGP · Omar owes you 150 EGP')).toBeVisible();
    await f.getByRole('button', { name: 'Add expense' }).click();
    await expect(f).toHaveCount(0);
    const row = page.locator('.list-item', { hasText: 'Dinner' });
    await expect(row).toContainText('150 EGP');
    await expect(row).toContainText('Split with Omar');

    await tab(page, 'Loans').click();
    await page.getByRole('tab', { name: 'Owed to me' }).click();
    await expect(page.locator('.hero')).toContainText('150 EGP');
    await expect(page.getByText('From a split expense')).toBeVisible();

    // Change Omar's share to 100: the loan follows
    await tab(page, 'Expenses').click();
    await page.locator('.list-item', { hasText: 'Dinner' }).locator('.list-main').click();
    const e = sheet(page, 'Edit expense');
    await expect(e.getByLabel('Total paid')).toHaveValue('300');
    await e.getByRole('tab', { name: 'Their share' }).click();
    await e.getByRole('textbox', { name: /^Their share/ }).fill('100');
    await e.getByRole('button', { name: 'Save changes' }).click();
    await expect(e).toHaveCount(0);
    await expect(page.locator('.list-item', { hasText: 'Dinner' })).toContainText('200 EGP');
    await tab(page, 'Loans').click();
    await page.getByRole('tab', { name: 'Owed to me' }).click();
    await expect(page.locator('.hero')).toContainText('100 EGP');

    // Deleting the expense removes Omar's entry too
    await tab(page, 'Expenses').click();
    await page.locator('.list-item', { hasText: 'Dinner' }).getByRole('button', { name: 'Delete expense' }).click();
    await tab(page, 'Loans').click();
    await page.getByRole('tab', { name: 'Owed to me' }).click();
    await expect(page.locator('.hero')).toContainText('0 EGP');
  });

  test('paid in another currency: converted at my rate, original shown on the row', async ({ page }) => {
    const f = await openAdd(page);
    await f.getByRole('button', { name: /More details/ }).click(); // 2.4.0: tags, split, receipt, currency fold away
    await f.getByText('Paid in another currency').click();
    await f.getByLabel('Amount in USD').fill('10');
    await f.getByLabel('Rate: 1 USD = ? EGP').fill('49.5');
    await expect(f.getByText('= 495 EGP in your currency')).toBeVisible();
    await f.getByLabel(/What for/).fill('App subscription');
    await f.getByRole('button', { name: 'Add expense' }).click();
    await expect(f).toHaveCount(0);
    const row = page.locator('.list-item', { hasText: 'App subscription' });
    await expect(row).toContainText('495 EGP');
    await expect(row).toContainText('10 USD');
  });

  test('export: CSV from Settings and Excel from the Expenses filter', async ({ page }) => {
    const f = await openAdd(page);
    await f.getByLabel('Amount').fill('45.5');
    await f.getByLabel(/What for/).fill('Koshary');
    await f.getByRole('button', { name: 'Add expense' }).click();
    await expect(f).toHaveCount(0);

    // From the Expenses filter: Excel
    await page.getByRole('button', { name: 'Export' }).click();
    const ex = sheet(page, 'Export these expenses');
    await expect(ex).toContainText('1 expense, with the filters you picked.');
    const [xl] = await Promise.all([page.waitForEvent('download'), ex.getByRole('link', { name: 'Download Excel (.xlsx)' }).click()]);
    expect(xl.suggestedFilename()).toMatch(/^budget-me-expenses-.*\.xlsx$/);
    const xbuf = readFileSync((await xl.path())!);
    expect(xbuf.subarray(0, 2).toString()).toBe('PK'); // a zip, like every .xlsx
    await page.keyboard.press('Escape');

    // From Settings: CSV of this month
    await tab(page, 'Home').click();
    await tab(page, 'Settings').click();
    await expect(page.getByRole('heading', { name: 'Export to a spreadsheet' })).toBeVisible();
    const [csv] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Download CSV' }).click()]);
    const text = readFileSync((await csv.path())!, 'utf8');
    expect(text.charCodeAt(0)).toBe(0xfeff); // BOM so Excel reads Arabic correctly
    expect(text).toContain('"Date","Time","Category","Description","Amount"'); // 2.2.0: time of day
    expect(text).toContain('"Food","Koshary",45.5,"EGP"');
  });
});
