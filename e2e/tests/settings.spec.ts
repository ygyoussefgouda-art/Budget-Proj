import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { setUpBudget, signUpAndSkipTutorial, tab } from './helpers';

test.describe('settings, language and navigation', () => {
  test.beforeEach(async ({ page }) => {
    await signUpAndSkipTutorial(page);
  });

  test('Arabic (Egyptian) switches the whole app to right-to-left and back', async ({ page }) => {
    await tab(page, 'Home').click();
    await tab(page, 'Settings').click();
    await page.getByRole('tab', { name: 'عربي' }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.getByRole('heading', { name: 'الإعدادات' })).toBeVisible();

    // Survives a reload (saved on the device) and the tabs are Egyptian Arabic
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const nav = page.getByRole('navigation');
    await expect(nav).toContainText('المصاريف');
    await expect(nav).toContainText('الميزانية');
    await expect(nav).toContainText('المزيد'); // 2.0.0: Savings and Loans are under More

    await page.getByRole('tab', { name: 'English' }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  });

  test('2.6.0: the accent colour changes the app at once and is saved on the account', async ({ page }) => {
    await setUpBudget(page); // Home shows the coloured band once there is an income
    await tab(page, 'Home').click();
    await tab(page, 'Settings').click();
    const picker = page.getByRole('group', { name: 'Accent colour' });
    await expect(picker.getByRole('button', { name: 'Lime' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('html')).not.toHaveAttribute('data-accent', /./);

    await picker.getByRole('button', { name: 'Violet' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-accent', 'violet');
    await expect(picker.getByRole('button', { name: 'Violet' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.tab-add')).toHaveCSS('background-color', 'rgb(198, 156, 255)');

    // It lives on the account, not only on this device: forget the device copy and it comes back
    await page.evaluate(() => localStorage.removeItem('sb-accent'));
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-accent', 'violet');

    // Light theme uses the darker ink for text and the bright colour on the band
    await page.getByRole('tab', { name: 'Light' }).click();
    await expect(page.getByRole('group', { name: 'Accent colour' })).toBeVisible();
    await tab(page, 'Home').click();
    await expect(page.locator('.home-band')).toHaveCSS('background-color', 'rgb(198, 156, 255)');

    await tab(page, 'Settings').click();
    await page.getByRole('group', { name: 'Accent colour' }).getByRole('button', { name: 'Lime' }).click();
    await expect(page.locator('html')).not.toHaveAttribute('data-accent', /./);
  });

  test('language selector is on the sign-in screen and defaults to the phone language', async ({ browser }) => {
    const ctx = await browser.newContext({ baseURL: 'http://localhost:3100', locale: 'ar-EG' });
    const p = await ctx.newPage();
    await p.goto('/');
    await expect(p.locator('html')).toHaveAttribute('dir', 'rtl'); // System = Arabic phone
    await expect(p.getByRole('button', { name: 'تسجيل الدخول', exact: true })).toBeVisible();
    await p.getByLabel('اللغة').selectOption('en');
    await expect(p.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(p.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    await ctx.close();
  });

  test('light / dark theme', async ({ page }) => {
    await tab(page, 'Home').click();
    await tab(page, 'Settings').click();
    await page.getByRole('tab', { name: 'Light' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe('rgb(237, 240, 238)'); // #edf0ee (Option E light page)
    await page.getByRole('tab', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(11, 15, 13)'); // #0b0f0d (Option E Night)
  });

  test('month start day changes the budget month range', async ({ page }) => {
    await tab(page, 'Home').click();
    await tab(page, 'Settings').click();
    // 2.6.0: one row under "Your month" opens the calendar in a sheet
    await page.getByRole('button', { name: /I get my money on day 1st/ }).click();
    const s = page.getByRole('dialog', { name: 'Month start' });
    await s.getByRole('radio', { name: '10' }).click();
    await expect(s.getByRole('radio', { name: '10' })).toHaveAttribute('aria-checked', 'true');
    await expect(s.getByText(/Each month starts on the 10th/)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(s).toBeHidden();
    await expect(page.getByRole('button', { name: /I get my money on day 10th/ })).toBeVisible();
    await tab(page, 'Home').click();
    await expect(page.locator('.month-range')).toHaveText(/^10\s\w{3} – 9\s\w{3}$/);
  });

  test('every tab opens at the top', async ({ page }) => {
    await setUpBudget(page);
    await tab(page, 'Home').click();
    // Home must be fully drawn (tall enough) before it can be scrolled; slow CI machines need a moment.
    await expect
      .poll(async () => page.evaluate(() => (window.scrollTo(0, 800), window.scrollY)))
      .toBeGreaterThan(100);
    for (const name of ['Budget', 'Expenses', 'Loans', 'Savings', 'Home'] as const) {
      await tab(page, name).click();
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
      await page.evaluate(() => window.scrollTo(0, 600));
    }
  });

  test('MK1: no badge under the name on Home; Settings shows the mark and credits the developer', async ({ page }) => {
    await tab(page, 'Home').click();
    await expect(page.locator('.page-header .stage-badge')).toHaveCount(0); // removed in 1.2.0 (owner's call)
    await tab(page, 'Settings').click();
    await expect(page.locator('.stage-badge').first()).toHaveText('MK1');
    const footer = page.locator('footer.app-footer');
    await expect(footer).toContainText('Developed by Youssef Gouda');
    await expect(footer).toContainText('Masrofy MK1 · Version 2.6.0');
    await expect(page.getByText(/alpha/i)).toHaveCount(0);
  });

  test('backup downloads a JSON file', async ({ page }) => {
    await setUpBudget(page);
    await tab(page, 'Home').click();
    await tab(page, 'Settings').click();
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download backup' }).click()]);
    expect(dl.suggestedFilename()).toMatch(/^budget-me-backup-\d{4}-\d{2}-\d{2}\.json$/);
    const file = await dl.path();
    const json = JSON.parse(readFileSync(file, 'utf8'));
    expect(json.app).toBe('student_budget');
    expect(json.tables.categories.map((c: { name: string }) => c.name)).toEqual(['Food', 'Uni']);
  });
});
