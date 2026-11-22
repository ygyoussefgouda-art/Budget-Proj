import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { setUpBudget, signUpAndSkipTutorial, tab } from './helpers';

test.describe('settings, language and navigation', () => {
  test.beforeEach(async ({ page }) => {
    await signUpAndSkipTutorial(page);
  });

  test('Arabic (Egyptian) switches the whole app to right-to-left and back', async ({ page }) => {
    await tab(page, 'Home').click();
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('tab', { name: 'عربي' }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.getByRole('heading', { name: 'الإعدادات' })).toBeVisible();

    // Survives a reload (saved on the device) and the tabs are Egyptian Arabic
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const nav = page.getByRole('navigation');
    await expect(nav).toContainText('المصاريف');
    await expect(nav).toContainText('التحويش');
    await expect(nav).toContainText('السلف');

    await page.getByRole('tab', { name: 'English' }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
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
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('tab', { name: 'Light' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe('rgb(245, 245, 247)'); // #f5f5f7
    await page.getByRole('tab', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(11, 12, 31)'); // #0b0c1f
  });

  test('month start day changes the budget month range', async ({ page }) => {
    await tab(page, 'Home').click();
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('radio', { name: '10' }).click();
    await expect(page.getByRole('radio', { name: '10' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByText(/Each month starts on the 10th/)).toBeVisible();
    await tab(page, 'Home').click();
    await expect(page.locator('.month-range')).toHaveText(/^10 \w{3} – 9 \w{3}$/);
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
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.locator('.stage-badge').first()).toHaveText('MK1');
    const footer = page.locator('footer.app-footer');
    await expect(footer).toContainText('Developed by Youssef Gouda');
    await expect(footer).toContainText('Masrofy MK1 · Version 1.3.0');
    await expect(page.getByText(/alpha/i)).toHaveCount(0);
  });

  test('backup downloads a JSON file', async ({ page }) => {
    await setUpBudget(page);
    await tab(page, 'Home').click();
    await page.getByRole('button', { name: 'Settings' }).click();
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download backup' }).click()]);
    expect(dl.suggestedFilename()).toMatch(/^budget-me-backup-\d{4}-\d{2}-\d{2}\.json$/);
    const file = await dl.path();
    const json = JSON.parse(readFileSync(file, 'utf8'));
    expect(json.app).toBe('student_budget');
    expect(json.tables.categories.map((c: { name: string }) => c.name)).toEqual(['Food', 'Uni']);
  });
});
