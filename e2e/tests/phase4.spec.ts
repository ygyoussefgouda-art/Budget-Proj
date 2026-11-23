import { expect, test, type Page } from '@playwright/test';
import { setUpBudget, sheet, signIn, signUpAndSkipTutorial, tab } from './helpers';

async function quickAdd(page: Page, amount: string, description: string) {
  await tab(page, 'Home').click();
  await page.getByRole('button', { name: 'New expense' }).click();
  const f = sheet(page, 'Quick add');
  await f.getByLabel('Amount').fill(amount);
  await f.getByLabel(/What for/).fill(description);
  await f.getByRole('button', { name: 'Add expense' }).click();
  await expect(f).toHaveCount(0);
}

/** Drag a row sideways with the pointer (like a finger swipe). */
async function swipe(page: Page, row: ReturnType<Page['locator']>, dx: number) {
  const box = (await row.boundingBox())!;
  const y = box.y + box.height / 2;
  const x = box.x + box.width / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(x + (dx * i) / 8, y);
  await page.mouse.up();
}

test.describe('phase 4: offline, shortcut, swipe, app lock', () => {
  test('offline: a new expense waits on the phone and is sent once when back online', async ({ page, context }) => {
    const user = await signUpAndSkipTutorial(page);
    await setUpBudget(page);
    await tab(page, 'Home').click();

    await context.setOffline(true);
    await quickAdd(page, '75', 'Offline lunch');
    await expect(page.getByText('Saved on this phone. It will be sent when you are back online.')).toBeVisible();
    await expect(page.getByText("You're offline. New expenses are saved on this phone and sync later.")).toBeVisible();
    const waiting = page.locator('.queued-card');
    await expect(waiting).toContainText('Offline lunch');
    await expect(waiting).toContainText('Waiting to sync');

    await context.setOffline(false);
    await expect(page.getByText('1 offline expense synced.')).toBeVisible({ timeout: 40_000 });
    await expect(page.locator('.queued-card')).toHaveCount(0);
    await tab(page, 'Expenses').click();
    await expect(page.locator('.list-item', { hasText: 'Offline lunch' })).toHaveCount(1);
    await expect(page.locator('.list-item', { hasText: 'Offline lunch' })).toContainText('75 EGP');
    expect(user).toBeTruthy();
  });

  test('opened with no connection: log an expense anyway, it syncs when online', async ({ page, context }) => {
    await signUpAndSkipTutorial(page);
    await setUpBudget(page);
    // Load once more online so the service worker controls the page and has the app cached.
    await page.reload();
    await expect(tab(page, 'Home')).toBeVisible();
    await page.waitForFunction(() => !!navigator.serviceWorker?.controller);
    await page.reload();
    await expect(tab(page, 'Home')).toBeVisible();

    // No saved copy of the data (e.g. it expired): the small offline entry screen still lets you log expenses.
    await page.evaluate(() => new Promise((r) => { const d = indexedDB.deleteDatabase('budget-me-cache'); d.onsuccess = d.onerror = d.onblocked = () => r(null); }));
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByText("You're offline. You can still log expenses; they are sent as soon as you're back online.")).toBeVisible();
    await page.getByLabel('Amount').fill('20');
    await page.getByLabel('Category').selectOption({ label: 'Food' });
    await page.getByLabel(/What for/).fill('Metro ticket');
    await page.getByRole('button', { name: 'Add expense' }).click();
    await expect(page.locator('.queued-card')).toContainText('Metro ticket');

    await context.setOffline(false);
    await expect(tab(page, 'Home')).toBeVisible({ timeout: 40_000 }); // the real app is back
    await tab(page, 'Expenses').click();
    await expect(page.locator('.list-item', { hasText: 'Metro ticket' })).toHaveCount(1, { timeout: 40_000 });
  });

  test('home-screen shortcut opens Quick add; the manifest offers it', async ({ page, request }) => {
    await signUpAndSkipTutorial(page);
    await setUpBudget(page);
    await page.goto('/?add=expense');
    await expect(sheet(page, 'Quick add')).toBeVisible();
    await expect(page).toHaveURL(/\/$/); // the ?add= is cleaned up
    const manifest = await (await request.get('/manifest.webmanifest')).json();
    expect(manifest.shortcuts[0]).toMatchObject({ name: 'Add expense', url: '/?add=expense' });
  });

  test('swipe a row left to delete (with Undo) and right to edit', async ({ page }) => {
    await signUpAndSkipTutorial(page);
    await setUpBudget(page);
    await quickAdd(page, '33', 'Swipe me');
    await tab(page, 'Expenses').click();
    const row = page.locator('.swipe', { hasText: 'Swipe me' });

    await swipe(page, row, -160);
    await expect(page.locator('.swipe', { hasText: 'Swipe me' })).toHaveCount(0);
    await page.locator('.toast', { hasText: 'Deleted' }).getByRole('button', { name: 'Undo' }).click();
    await expect(page.locator('.swipe', { hasText: 'Swipe me' })).toHaveCount(1);

    await swipe(page, page.locator('.swipe', { hasText: 'Swipe me' }), 160);
    await expect(sheet(page, 'Edit expense')).toBeVisible();
  });

  test('app lock: PIN on reopen, wrong PIN refused, "forgot PIN" signs out', async ({ page }) => {
    const user = await signUpAndSkipTutorial(page);
    await tab(page, 'Home').click();
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Set a PIN' }).click();
    const s = sheet(page, 'Set a PIN');
    await s.getByLabel('New PIN (4–6 digits)').fill('1234');
    await s.getByLabel('Repeat the PIN').fill('1234');
    await s.getByLabel('Lock the app').selectOption({ label: 'Right away' });
    await s.getByRole('button', { name: 'Turn on app lock' }).click();
    await expect(page.getByText('App lock is on.')).toBeVisible();

    // Reopen: locked, nothing of the app behind it
    await page.reload();
    const lock = page.getByRole('dialog', { name: 'App locked' });
    await expect(lock).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
    for (const d of '1111') await lock.getByRole('button', { name: d, exact: true }).click();
    await expect(lock.getByText('Wrong PIN. Try again.')).toBeVisible();
    for (const d of '1234') await lock.getByRole('button', { name: d, exact: true }).click();
    await expect(lock).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();

    // Forgot it: sign out; signing in again has no lock
    await page.reload();
    await page.getByRole('button', { name: 'Forgot your PIN? Sign out' }).click();
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    await signIn(page, user);
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'App locked' })).toHaveCount(0);
  });
});
