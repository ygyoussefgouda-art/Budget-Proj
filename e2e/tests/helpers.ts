import { devices, expect, type Browser, type Page } from '@playwright/test';

/** A second, separate browser (other user) with the same phone settings. */
export const newPhonePage = async (browser: Browser) => {
  const ctx = await browser.newContext({ ...devices['Pixel 7'], baseURL: 'http://localhost:3100', locale: 'en-US', timezoneId: 'Africa/Cairo' });
  return { ctx, page: await ctx.newPage() };
};

let counter = 0;
/** A unique, valid username for this run. */
export const newUsername = (prefix = 'e2e') => `${prefix}.${Date.now().toString(36)}${(counter++).toString(36)}`;
export const PASSWORD = 'Correct-horse-9'; // meets the rules: lower, upper, number, special, 8+
export const emailFor = (username: string) => `${username}@example.com`;

/** Creates a brand-new account through the UI. Leaves the first-run tutorial open. */
export async function signUp(page: Page, username = newUsername()) {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Create account' }).click();
  await page.getByLabel('Email').fill(emailFor(username));
  await page.getByLabel('Username').fill(username);
  await page.getByLabel(/^Password/).fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('dialog', { name: /Welcome to Masrofy/ })).toBeVisible();
  return username;
}

/** Sign up and close the tutorial: ready on the Budget tab. */
export async function signUpAndSkipTutorial(page: Page, username = newUsername()) {
  await signUp(page, username);
  await page.getByRole('button', { name: 'Skip' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  return username;
}

export async function signIn(page: Page, username: string, password = PASSWORD) {
  await page.goto('/');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel(/^Password/).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

/**
 * Bottom navigation (2.0.0: Home · Expenses · + · Budget · More). Savings and Loans live on the More page,
 * so for those two this opens More and then the entry there.
 */
export const tab = (page: Page, name: 'Home' | 'Budget' | 'Expenses' | 'Loans' | 'Savings' | 'More') => {
  const nav = page.getByRole('navigation', { name: 'Main' });
  if (name === 'Loans' || name === 'Savings') {
    return {
      click: async () => {
        await nav.getByRole('link', { name: 'More' }).click();
        await page.locator('.more-list').getByRole('link', { name: new RegExp(`^${name}`) }).click();
      },
    };
  }
  return nav.getByRole('link', { name });
};

/** The open bottom sheet (form). */
export const sheet = (page: Page, title: string | RegExp) => page.getByRole('dialog', { name: title });

/** Answers the in-app confirm dialog. */
export async function confirmDialog(page: Page, action: string | RegExp) {
  const dlg = page.getByRole('alertdialog');
  await expect(dlg).toBeVisible();
  await dlg.getByRole('button', { name: action }).click();
  await expect(dlg).toHaveCount(0);
}

/** Sets up income, plans and one fixed + one per-day category for the current month. */
export async function setUpBudget(page: Page) {
  await tab(page, 'Budget').click();
  await page.getByRole('button', { name: /Income & plans/ }).click();
  const s = sheet(page, /Income & plans/);
  await s.getByLabel(/Income for/).fill('5000');
  await s.getByLabel('Monthly saving plan').fill('1000');
  await s.getByLabel('Monthly loan repayment plan').fill('500');
  await s.getByRole('button', { name: 'Save' }).click();
  await expect(s).toHaveCount(0);

  await page.getByRole('button', { name: 'Add a spending category' }).click();
  let c = sheet(page, 'New category');
  await c.getByLabel('Name').fill('Food');
  await c.getByLabel(/Monthly budget for/).fill('1500');
  await c.getByRole('button', { name: 'Save' }).click();
  await expect(c).toHaveCount(0);

  await page.getByRole('button', { name: 'Add a spending category' }).click();
  c = sheet(page, 'New category');
  await c.getByLabel('Name').fill('Uni');
  await c.getByText('Budget per day').click();
  await c.getByLabel('Days / week').fill('3');
  await c.getByLabel('Weeks / month').fill('4');
  await c.getByLabel('Cost / day').fill('100');
  await expect(c.getByText('1,200 EGP')).toBeVisible();
  await c.getByRole('button', { name: 'Save' }).click();
  await expect(c).toHaveCount(0);
}
