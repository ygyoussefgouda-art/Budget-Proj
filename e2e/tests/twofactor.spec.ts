import { createHmac } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { PASSWORD, signIn, signUpAndSkipTutorial, tab } from './helpers';

/** The same TOTP an authenticator app computes (RFC 6238, SHA-1, 30 s, 6 digits). */
function totp(base32: string, offset = 0) {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of base32.replace(/\s/g, '')) {
    value = (value << 5) | abc.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offset));
  const h = createHmac('sha1', Buffer.from(bytes)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, '0');
}

test('two-step sign-in: turn it on, sign in with a code, use a backup code', async ({ page }) => {
  const name = await signUpAndSkipTutorial(page);
  await tab(page, 'Home').click();
  await tab(page, 'Settings').click();
  await page.getByRole('button', { name: 'Turn on two-step sign-in' }).click();
  const s = page.getByRole('dialog', { name: 'Two-step sign-in' });
  await s.getByLabel('Your password').fill(PASSWORD);
  await s.getByRole('button', { name: 'Continue' }).click();
  await expect(s.getByRole('link', { name: 'Open in authenticator app' })).toHaveAttribute('href', /^otpauth:\/\/totp\//);
  const secret = (await s.getByLabel('Setup key').innerText()).replace(/\s/g, '');
  await s.getByLabel(/Enter the 6-digit code/).fill(totp(secret));
  await s.getByRole('button', { name: 'Turn on' }).click();
  const codes = (await s.getByLabel('Backup codes').innerText()).split(/\s+/).filter(Boolean);
  expect(codes).toHaveLength(8);
  await s.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText('On: signing in needs your password and a code from your authenticator app.')).toBeVisible();

  // Sign out, sign in: the password alone is not enough
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await signIn(page, name);
  await expect(page.getByRole('heading', { name: 'Two-step sign-in' })).toBeVisible();
  await page.getByLabel('Code').fill('000000');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('That code is not right. Try the newest code from your app.')).toBeVisible();
  await page.getByLabel('Code').fill(totp(secret, 1)); // the next step's code (the current one was used to turn it on)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();

  // A backup code works too (a lost phone)
  await tab(page, 'Home').click();
  await tab(page, 'Settings').click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await signIn(page, name);
  await page.getByLabel('Code').fill(codes[0].toLowerCase());
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
});
