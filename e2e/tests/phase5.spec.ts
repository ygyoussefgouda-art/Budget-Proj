import { expect, test, type Page } from '@playwright/test';
import { newPhonePage, PASSWORD, sheet, signIn, signUpAndSkipTutorial, tab } from './helpers';

const OWNER_PASSWORD = 'e2e-owner-pass-123'; // set for the test server in playwright.config.ts

async function openAdminAsOwner(page: Page) {
  await signIn(page, 'owner', OWNER_PASSWORD);
  // First sign-in on this (fresh) browser: the tutorial opens; skip it.
  await expect(page.getByRole('dialog', { name: /Welcome to Budget me/ })).toBeVisible();
  await page.getByRole('button', { name: 'Skip' }).click();
  await tab(page, 'Home').click();
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Open the admin page' }).click();
  await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();
}

test.describe('phase 5: admin page and password reset', () => {
  test('forgot password: the admin makes a one-time code, the user picks a new password', async ({ page, browser }) => {
    const { ctx, page: phone } = await newPhonePage(browser);
    const name = await signUpAndSkipTutorial(phone);

    await openAdminAsOwner(page);
    await page.getByRole('button', { name: `Password reset code for ${name}` }).click();
    const codeSheet = sheet(page, 'Password reset code');
    const code = (await codeSheet.locator('.reset-code').innerText()).trim();
    expect(code).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    await page.keyboard.press('Escape');

    // On the user's phone: sign out, then "Forgot password?"
    await tab(phone, 'Home').click();
    await phone.getByRole('button', { name: 'Settings' }).click();
    await phone.getByRole('button', { name: 'Sign out', exact: true }).click();
    await phone.getByRole('button', { name: 'Forgot password?' }).click();
    await phone.getByLabel('Username').fill(name);
    await phone.getByLabel('Reset code').fill(code.toLowerCase());
    await phone.getByLabel(/^New password/).fill('my-new-password-1');
    await phone.getByLabel('Repeat new password').fill('my-new-password-1');
    await phone.getByRole('button', { name: 'Set new password' }).click();
    await expect(phone.getByText('Password changed. Sign in with your new password.')).toBeVisible();
    await expect(phone.getByLabel('Username')).toHaveValue(name);

    // The old password no longer works, the new one does
    await phone.getByLabel(/^Password/).fill(PASSWORD);
    await phone.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(phone.getByText('Wrong username or password.')).toBeVisible();
    await phone.getByLabel(/^Password/).fill('my-new-password-1');
    await phone.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(phone.getByRole('navigation', { name: 'Main' })).toBeVisible();
    await ctx.close();

    await page.reload();
    const log = page.locator('.audit-row');
    await expect(log.filter({ hasText: `owner made a password reset code for "${name}"` })).toHaveCount(1);
    await expect(log.filter({ hasText: `"${name}" chose a new password with a reset code` })).toHaveCount(1);
  });

  test('remove an account: type its name and your own password', async ({ page, browser }) => {
    const { ctx, page: phone } = await newPhonePage(browser);
    const name = await signUpAndSkipTutorial(phone);
    await ctx.close();

    await openAdminAsOwner(page);
    const row = page.locator('.admin-user', { hasText: name });
    await expect(row).toContainText('Joined');
    await row.getByRole('button', { name: `Remove ${name}` }).click();
    const s = sheet(page, 'Remove an account');
    await s.getByLabel(`Type "${name}" to confirm`).fill('not-the-name');
    await s.getByLabel('Your password').fill(OWNER_PASSWORD);
    await s.getByRole('button', { name: 'Remove account' }).click();
    await expect(s.getByText('Type the username exactly to confirm.')).toBeVisible();
    await s.getByLabel(`Type "${name}" to confirm`).fill(name);
    await s.getByRole('button', { name: 'Remove account' }).click();
    await expect(page.getByText(`"${name}" was removed.`)).toBeVisible();
    await expect(page.locator('.admin-user', { hasText: name })).toHaveCount(0);
    await expect(page.locator('.audit-row').first()).toContainText(`owner removed the account "${name}"`);
    await expect(page.getByRole('heading', { name: 'Sign-ups' })).toBeVisible();
  });

  test('a normal account sees no admin page', async ({ page }) => {
    await signUpAndSkipTutorial(page);
    await tab(page, 'Home').click();
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByRole('button', { name: 'Open the admin page' })).toHaveCount(0);
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/settings$/);
  });
});
