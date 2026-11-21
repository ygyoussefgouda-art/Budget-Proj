import { expect, test } from '@playwright/test';
import { newPhonePage, newUsername, PASSWORD, signIn, signUp, signUpAndSkipTutorial, tab } from './helpers';

test.describe('accounts', () => {
  test('sign-up validates input before sending anything', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('tab', { name: 'Create account' }).click();
    await page.getByLabel('Username').fill('x');
    await page.getByLabel(/^Password/).fill(PASSWORD);
    await page.getByLabel('Repeat password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await expect(page.getByText(/Usernames are 3–30 characters/)).toBeVisible();

    await page.getByLabel('Username').fill(newUsername());
    await page.getByLabel('Repeat password').fill('something-else');
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await expect(page.getByText('The two passwords do not match.')).toBeVisible();

    await page.getByLabel(/^Password/).fill('short');
    await page.getByLabel('Repeat password').fill('short');
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await expect(page.getByText('Use a password of at least 10 characters.')).toBeVisible();
  });

  test('a new account starts empty, signs out and back in', async ({ page }) => {
    const user = await signUpAndSkipTutorial(page);
    await tab(page, 'Home').click();
    await expect(page.getByText('No expenses logged in this month.')).toBeVisible();
    await expect(page.getByText('Nothing logged yet.')).toBeVisible();

    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByText(`Signed in as ${user}`)).toBeVisible();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();

    // Wrong password: generic message (does not reveal whether the username exists)
    await signIn(page, user, 'wrong-password');
    await expect(page.getByText('Wrong username or password.')).toBeVisible();
    await signIn(page, 'no.such.user', PASSWORD);
    await expect(page.getByText('Wrong username or password.')).toBeVisible();

    await signIn(page, user);
    await expect(tab(page, 'Home')).toBeVisible();
    // The tutorial is shown only once per account
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('the same username cannot be taken twice (any capitals)', async ({ page, browser }) => {
    const user = await signUpAndSkipTutorial(page);
    const { ctx, page: other } = await newPhonePage(browser);
    await other.goto('/');
    await other.getByRole('tab', { name: 'Create account' }).click();
    await other.getByLabel('Username').fill(user.toUpperCase());
    await other.getByLabel(/^Password/).fill(PASSWORD);
    await other.getByLabel('Repeat password').fill(PASSWORD);
    await other.getByRole('button', { name: 'Create account', exact: true }).click();
    await expect(other.getByText(/already taken/)).toBeVisible();
    await ctx.close();
  });

  test('accounts never see each other’s data', async ({ page, browser }) => {
    await signUpAndSkipTutorial(page);
    await page.getByRole('button', { name: 'Add a spending category' }).click();
    await page.getByRole('dialog', { name: 'New category' }).getByLabel('Name').fill('Secret category A');
    await page.getByRole('dialog', { name: 'New category' }).getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Secret category A').first()).toBeVisible();

    const { ctx, page: b } = await newPhonePage(browser);
    await signUpAndSkipTutorial(b);
    await expect(b.getByText('No categories yet. Add your first one.')).toBeVisible();
    await expect(b.getByText('Secret category A')).toHaveCount(0);

    // Direct API probing with B's session: A's ids are not reachable
    const state = await b.request.get('/api/state?month=2026-11');
    expect(JSON.stringify(await state.json())).not.toContain('Secret category A');
    await ctx.close();
  });

  test('pages need a session: API returns 401 when signed out', async ({ request }) => {
    for (const path of ['/api/state?month=2026-11', '/api/expenses', '/api/backup', '/api/reports/year?y=2026']) {
      const r = await request.get(path);
      expect(r.status(), path).toBe(401);
    }
  });

  test('first-run tutorial walks through every tab and the month-start calendar', async ({ page }) => {
    await signUp(page);
    const dlg = page.getByRole('dialog');
    await expect(dlg.getByText('Step 1 of 8')).toBeVisible();
    await dlg.getByRole('button', { name: 'Next' }).click();

    // Step 2: choose the day the money arrives on the calendar
    await expect(dlg.getByText('When do you get your money?')).toBeVisible();
    await dlg.getByRole('radio', { name: '25' }).click();
    await expect(dlg.getByRole('radio', { name: '25' })).toHaveAttribute('aria-checked', 'true');
    await expect(dlg.getByRole('radio', { name: '30' })).toBeDisabled();

    const expectedPaths = ['/', '/budget', '/expenses', '/savings', '/loans', '/settings'];
    for (const p of expectedPaths) {
      await dlg.getByRole('button', { name: 'Next' }).click();
      await expect(page).toHaveURL(new RegExp(`${p === '/' ? '/$' : p}`));
    }
    await expect(dlg.getByRole('button', { name: 'Get started' })).toBeVisible();
    await dlg.getByRole('button', { name: 'Get started' }).click();
    await expect(page).toHaveURL(/\/budget$/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('change password, then the old one stops working; delete account', async ({ page }) => {
    const user = await signUpAndSkipTutorial(page);
    await tab(page, 'Home').click();
    await page.getByRole('button', { name: 'Settings' }).click();

    await page.getByRole('button', { name: 'Change password' }).click();
    const s = page.getByRole('dialog', { name: 'Change password' });
    await s.getByLabel('Current password').fill('wrong-password-1');
    await s.getByLabel(/^New password/).fill('brand-new-pass-1');
    await s.getByLabel('Repeat new password').fill('brand-new-pass-1');
    await s.getByRole('button', { name: 'Change password' }).click();
    await expect(s.getByText('Your current password is not right.')).toBeVisible();
    await s.getByLabel('Current password').fill(PASSWORD);
    await s.getByRole('button', { name: 'Change password' }).click();
    await expect(s).toHaveCount(0);
    await expect(page.getByText('Password changed. Other devices were signed out.')).toBeVisible();

    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await signIn(page, user, PASSWORD);
    await expect(page.getByText('Wrong username or password.')).toBeVisible();
    await signIn(page, user, 'brand-new-pass-1');
    await expect(tab(page, 'Home')).toBeVisible();

    // Delete the account: password + confirmation, then it is gone
    await tab(page, 'Home').click();
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Delete my account' }).click();
    const d = page.getByRole('dialog', { name: 'Delete my account' });
    await d.getByLabel('Your password').fill('brand-new-pass-1');
    await d.getByRole('button', { name: 'Delete my account' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    await signIn(page, user, 'brand-new-pass-1');
    await expect(page.getByText('Wrong username or password.')).toBeVisible();
  });
});