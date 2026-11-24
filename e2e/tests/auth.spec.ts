import { expect, test } from '@playwright/test';
import { newPhonePage, newUsername, PASSWORD, signIn, signUp, signUpAndSkipTutorial, tab } from './helpers';

test.describe('accounts', () => {
  test('sign-up validates input before sending anything', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('tab', { name: 'Create account' }).click();
    const create = () => page.getByRole('button', { name: 'Create account', exact: true }).click();
    await page.getByLabel('Username').fill(newUsername());
    await page.getByLabel(/^Password/).fill(PASSWORD);
    await create();
    await expect(page.getByText('Enter your email address.')).toBeVisible();

    await page.getByLabel('Email').fill('not-an-email');
    await create();
    await expect(page.getByText('That email address does not look right.')).toBeVisible();

    await page.getByLabel('Email').fill('someone@example.com');
    await page.getByLabel('Username').fill('x');
    await create();
    await expect(page.getByText(/Usernames are 3–30 characters/)).toBeVisible();

    // The password rules tick off as they are met.
    await page.getByLabel('Username').fill(newUsername());
    const rules = page.getByRole('list', { name: 'Rules for the new password' });
    await page.getByLabel(/^Password/).fill('short');
    await expect(rules.locator('li.ok')).toHaveCount(1);
    await expect(rules.locator('li.ok')).toContainText('One lowercase character');
    await create();
    await expect(page.getByText('Your password does not meet all the rules yet.')).toBeVisible();
    await page.getByLabel(/^Password/).fill('Short-pass-1');
    await expect(rules.locator('li.ok')).toHaveCount(5);
    // Show / Hide
    await page.getByRole('button', { name: 'Show' }).click();
    await expect(page.getByLabel(/^Password/)).toHaveAttribute('type', 'text');
  });

  test('a new account starts empty, signs out and back in', async ({ page }) => {
    const user = await signUpAndSkipTutorial(page);
    await tab(page, 'Home').click();
    // 2.1.0: Home no longer shows an empty "Where it went" (the ring moved to Reports)
    await expect(page.getByText('Where it went')).toHaveCount(0);
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

  test('loading screen while signing in, then always Home (not the page you signed out from)', async ({ page }) => {
    // The page itself carries the loading screen, so there is no blank screen before the app's code loads.
    const html = await (await page.request.get('/')).text();
    expect(html).toContain('class="boot-dots"');
    expect(html).toContain('See where every pound goes');

    const user = await signUpAndSkipTutorial(page);
    await tab(page, 'Home').click();
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(/\/settings$/); // still there, on the sign-in screen

    // Slow the server down a little so the loading screen can be seen.
    await page.route('**/api/auth/login', async (r) => {
      await new Promise((ok) => setTimeout(ok, 800));
      await r.continue();
    });
    await page.getByLabel('Username').fill(user);
    await page.getByLabel(/^Password/).fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    const loading = page.getByRole('status');
    await expect(loading).toContainText('Signing in…');
    await expect(loading.locator('.boot-dots')).toBeVisible();

    await expect(page).toHaveURL(/\/$/);
    await expect(tab(page, 'Home')).toHaveClass(/active/);
    // The fade-out layer goes away and never blocks taps.
    await expect(page.locator('.boot-exit')).toHaveCount(0);
    await expect(page.locator('.splash.boot')).toHaveCount(0);
  });

  test('the same username cannot be taken twice (any capitals)', async ({ page, browser }) => {
    const user = await signUpAndSkipTutorial(page);
    const { ctx, page: other } = await newPhonePage(browser);
    await other.goto('/');
    await other.getByRole('tab', { name: 'Create account' }).click();
    await other.getByLabel('Email').fill('another.person@example.com');
    await other.getByLabel('Username').fill(user.toUpperCase());
    await other.getByLabel(/^Password/).fill(PASSWORD);
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

  test('first-run tour (2.1.0): payday, income, where things are, then the first expense', async ({ page }) => {
    await signUp(page);
    const dlg = page.getByRole('dialog');
    await expect(dlg.getByText('Step 1 of 6')).toBeVisible();
    await expect(dlg.getByRole('button', { name: 'Back' })).toHaveCount(0); // nothing to go back to
    await dlg.getByRole('button', { name: 'Next' }).click();

    // Step 2: the day the money arrives, saved at once
    await expect(dlg.getByText('When do you get your money?')).toBeVisible();
    await dlg.getByRole('radio', { name: '25' }).click();
    await expect(dlg.getByRole('radio', { name: '25' })).toHaveAttribute('aria-checked', 'true');
    await expect(dlg.getByText('Day saved')).toBeVisible();
    await expect(dlg.getByRole('radio', { name: '30' })).toBeDisabled();
    await expect(dlg.getByText('Paid on the 29th–31st? Choose the 28th.')).toBeVisible();
    // Arrow keys move between days; they don't change the step
    await dlg.getByRole('radio', { name: '25' }).press('ArrowRight');
    await expect(dlg.getByRole('radio', { name: '26' })).toBeFocused();
    await expect(dlg.getByText('Step 2 of 6')).toBeVisible();
    await dlg.getByRole('button', { name: 'Next' }).click();

    // Step 3: the monthly income, saved when going on
    await expect(dlg.getByText('How much do you get a month?')).toBeVisible();
    await dlg.getByLabel(/Income for/).fill('4500');
    await dlg.getByRole('button', { name: 'Next' }).click();

    // Step 4 (2.1.3): app lock. A mismatch is refused, then the PIN turns the lock on.
    await expect(dlg.getByText('Lock the app with a PIN')).toBeVisible();
    await dlg.getByLabel('PIN (4–6 digits)').fill('2468');
    await dlg.getByLabel('Repeat the PIN').fill('2469');
    await dlg.getByRole('button', { name: 'Next' }).click();
    await expect(dlg.getByText('The two PINs do not match.')).toBeVisible();
    await dlg.getByLabel('Repeat the PIN').fill('2468');
    await dlg.getByRole('button', { name: 'Turn on app lock' }).click();
    await expect(dlg.getByText('App lock is on.')).toBeVisible();
    await dlg.getByRole('button', { name: 'Next' }).click();

    // Step 5: where things are (the bottom bar shows above the dim layer)
    await expect(dlg.getByText('Where things are')).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
    await dlg.getByRole('button', { name: 'Next' }).click();

    // Step 6: log the first expense; the tour ends on Home with quick add open
    await expect(dlg.getByText('Step 6 of 6')).toBeVisible();
    await dlg.getByRole('button', { name: 'Log an expense' }).click();
    await expect(page.getByRole('dialog', { name: 'Quick add' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByText('Your budget left').locator('..')).toContainText('4,500 EGP');

    // The PIN set in the tour really locks the app (switch Settings to "lock right away", then reopen)
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByLabel('Lock the app').selectOption({ label: 'Right away' });
    await page.reload();
    const lock = page.getByRole('dialog', { name: 'App locked' });
    await expect(lock).toBeVisible();
    for (const d of '2468') await lock.getByRole('button', { name: d, exact: true }).click();
    await expect(lock).toHaveCount(0);
    await expect(page.getByText('Step 1 of 6')).toHaveCount(0); // finished: not shown again
  });

  test('the tour card fits a small phone: Skip and the buttons stay on screen', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 600 });
    await signUp(page);
    const dlg = page.getByRole('dialog');
    await dlg.getByRole('button', { name: 'Next' }).click(); // the payday step is the tallest
    for (const name of ['Skip', 'Next', 'Back']) {
      const box = (await dlg.getByRole('button', { name }).boundingBox())!;
      expect(box.y, name).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height, name).toBeLessThanOrEqual(600);
    }
  });

  test('change password, then the old one stops working; delete account', async ({ page }) => {
    const user = await signUpAndSkipTutorial(page);
    await tab(page, 'Home').click();
    await page.getByRole('button', { name: 'Settings' }).click();

    await page.getByRole('button', { name: 'Change password' }).click();
    const s = page.getByRole('dialog', { name: 'Change password' });
    await s.getByLabel('Current password').fill('wrong-password-1');
    await s.getByLabel(/^New password/).fill('Brand-new-pass-1');
    await s.getByLabel('Repeat new password').fill('Brand-new-pass-1');
    await s.getByRole('button', { name: 'Change password' }).click();
    await expect(s.getByText('Your current password is not right.')).toBeVisible();
    await s.getByLabel('Current password').fill(PASSWORD);
    await s.getByRole('button', { name: 'Change password' }).click();
    await expect(s).toHaveCount(0);
    await expect(page.getByText('Password changed. Other devices were signed out.')).toBeVisible();

    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await signIn(page, user, PASSWORD);
    await expect(page.getByText('Wrong username or password.')).toBeVisible();
    await signIn(page, user, 'Brand-new-pass-1');
    await expect(tab(page, 'Home')).toBeVisible();

    // Delete the account: password + confirmation, then it is gone
    await tab(page, 'Home').click();
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Delete my account' }).click();
    const d = page.getByRole('dialog', { name: 'Delete my account' });
    await d.getByLabel('Your password').fill('Brand-new-pass-1');
    await d.getByRole('button', { name: 'Delete my account' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    await signIn(page, user, 'Brand-new-pass-1');
    await expect(page.getByText('Wrong username or password.')).toBeVisible();
  });
});