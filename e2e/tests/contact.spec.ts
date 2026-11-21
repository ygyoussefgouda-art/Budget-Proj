import { expect, test } from '@playwright/test';
import { signUpAndSkipTutorial, tab } from './helpers';

test('Settings → Contact us opens an email for a bug report or a feature idea', async ({ page }) => {
  await signUpAndSkipTutorial(page);
  await tab(page, 'Home').click();
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Contact us' })).toBeVisible();

  const bug = await page.getByRole('link', { name: 'Report a bug' }).getAttribute('href');
  const idea = await page.getByRole('link', { name: 'Suggest a feature' }).getAttribute('href');
  for (const href of [bug!, idea!]) expect(href.startsWith('mailto:youssefgoudawork@gmail.com?subject=')).toBe(true);

  const params = (href: string) => new URLSearchParams(href.slice(href.indexOf('?') + 1));
  expect(params(bug!).get('subject')).toMatch(/^\[Bug\] Budget me \d+\.\d+\.\d+$/);
  expect(params(bug!).get('body')).toContain('What happened?');
  expect(params(idea!).get('subject')).toMatch(/^\[Idea\] Budget me /);
  expect(params(idea!).get('body')).toContain('What would you like the app to do?');
  await expect(page.getByRole('link', { name: 'youssefgoudawork@gmail.com' })).toHaveAttribute('href', 'mailto:youssefgoudawork@gmail.com');
});
