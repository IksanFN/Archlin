import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { resetAccount } from './helpers/db';
import { expectNoA11yViolations } from './helpers/a11y';
import { ACCOUNT, completeSetup, openAccountMenu, signOut, gotoSettled, reloadSettled } from './helpers/flows';

for (const theme of ['light', 'dark'] as const) {
  test(`has no axe violations in ${theme} mode`, async ({ page }) => {
    await resetAccount();
    await page.addInitScript((chosen) => window.localStorage.setItem('archlin.theme', chosen), theme);

    const check = async (path: string): Promise<void> => {
      await gotoSettled(page, path);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expectNoA11yViolations(page);
    };

    await check('/setup');
    await completeSetup(page);
    await check('/');
    await check('/settings/security');
    await signOut(page);
    await check('/login');
    await check('/login/totp');
  });
}

async function startAtLogin(page: Page): Promise<void> {
  await resetAccount();
  await completeSetup(page);
  await signOut(page);
}

test('completes login with the keyboard only', async ({ page }) => {
  await startAtLogin(page);
  await gotoSettled(page, '/login');
  // The email field takes focus on load, so the skip link is the stop right before it.
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('link', { name: 'Lewati ke konten' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Email')).toBeFocused();
  await page.keyboard.type(ACCOUNT.email);
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Password', { exact: true })).toBeFocused();
  await page.keyboard.type(ACCOUNT.password);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL('/');
});

test('returns focus after closing a dialog with Escape', async ({ page }) => {
  await resetAccount();
  await completeSetup(page);
  await gotoSettled(page, '/settings/security');
  const trigger = page.getByRole('button', { name: 'Ganti password' });
  await trigger.click();
  await expect(page.getByRole('dialog', { name: 'Ganti password' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('theme choice persists across reloads', async ({ page }) => {
  await resetAccount();
  await completeSetup(page);
  await openAccountMenu(page);
  await page.getByRole('menuitemradio', { name: 'Terang' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await reloadSettled(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});
