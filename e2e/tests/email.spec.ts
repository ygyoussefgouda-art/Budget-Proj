import { expect, test } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emailFor, PASSWORD, signUpAndSkipTutorial, tab } from './helpers';

const outbox = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'mail-outbox');

/** The newest reset code emailed to this address (the test server writes mails to e2e/mail-outbox). */
async function codeFromEmail(to: string): Promise<string> {
  for (let i = 0; i < 50; i++) {
    let files: string[] = [];
    try {
      files = readdirSync(outbox).sort();
    } catch {
      // folder not made yet
    }
    for (const f of files.reverse()) {
      const m = JSON.parse(readFileSync(path.join(outbox, f), 'utf8')) as { to: string; text: string };
      if (m.to === to) return /([A-Z2-9]{5}-[A-Z2-9]{5})/.exec(m.text)![1];
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`no email to ${to}`);
}

test.describe('0.6.3: email', () => {
  test('forgot password: a code by email, a new password, sign in with the email', async ({ page }) => {
    const name = await signUpAndSkipTutorial(page);
    const email = emailFor(name);
    await tab(page, 'Home').click();
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByText(email)).toBeVisible(); // shown under Account
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();

    await page.getByRole('button', { name: 'Forgot password?' }).click();
    await page.getByLabel('Email').fill(email.toUpperCase());
    await page.getByRole('button', { name: 'Email me a code' }).click();
    await expect(page.getByText(/a code is on its way/)).toBeVisible();
    const code = await codeFromEmail(email);

    await page.getByLabel('Reset code').fill(code);
    await page.getByLabel(/^New password/).fill('weakpassword');
    await page.getByRole('button', { name: 'Set new password' }).click();
    await expect(page.getByText('Your password does not meet all the rules yet.')).toBeVisible();
    await page.getByLabel(/^New password/).fill('Fresh-start-77');
    await page.getByRole('button', { name: 'Set new password' }).click();
    await expect(page.getByText('Password changed. Sign in with your new password.')).toBeVisible();

    // Sign in with the email instead of the username
    await page.getByLabel('Username or email').fill(email);
    await page.getByLabel(/^Password/).fill('Fresh-start-77');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  });

  test('an unknown address gets the same answer (nothing is revealed)', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Forgot password?' }).click();
    await page.getByLabel('Email').fill('nobody.at.all@example.com');
    await page.getByRole('button', { name: 'Email me a code' }).click();
    await expect(page.getByText(/If an account uses nobody.at.all@example.com, a code is on its way/)).toBeVisible();
  });

  test('change the email in Settings (needs the password)', async ({ page }) => {
    const name = await signUpAndSkipTutorial(page);
    await tab(page, 'Home').click();
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Change', exact: true }).click();
    const s = page.getByRole('dialog', { name: 'Change email' });
    await s.getByLabel('Email').fill(`new.${name}@example.com`);
    await s.getByLabel('Your password', { exact: true }).fill(PASSWORD);
    await s.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Email saved.')).toBeVisible();
    await expect(page.getByText(`new.${name}@example.com`)).toBeVisible();
  });
});
