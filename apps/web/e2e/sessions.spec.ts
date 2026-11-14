import { expect, test } from '@playwright/test';
import { completeSetup, signIn, gotoSettled } from './helpers/flows';
import { resetAccount } from './helpers/db';
import { advanceClock } from './helpers/totp';

const SEVEN_DAYS_AND_A_MINUTE = 7 * 24 * 60 * 60_000 + 60_000;

test.beforeEach(async () => {
  await resetAccount();
});

test('revokes another session', async ({ page, browser }) => {
  await completeSetup(page);

  const other = await browser.newContext();
  try {
    const otherPage = await other.newPage();
    await signIn(otherPage);

    await gotoSettled(page, '/settings/security');
    const sessions = page.getByRole('region', { name: 'Sesi aktif' });
    await expect(sessions.getByRole('button', { name: 'Cabut' })).toHaveCount(1);
    await sessions.getByRole('button', { name: 'Cabut' }).click();
    await page.getByRole('dialog', { name: 'Cabut sesi ini?' }).getByRole('button', { name: 'Cabut' }).click();
    await expect(page.getByText('Sesi dicabut.')).toBeVisible();

    await otherPage.goto('/');
    await expect(otherPage).toHaveURL(/\/login/);
  } finally {
    await other.close();
  }
});

test('expires an idle session after seven days', async ({ page, request }) => {
  await completeSetup(page);
  await advanceClock(request, SEVEN_DAYS_AND_A_MINUTE);
  // Firefox reports a driver-awaited reload that ends in a redirect as NS_BINDING_ABORTED late in a long run; reloading
  // from inside the page leaves only the redirect to assert.
  await page.evaluate(() => window.location.reload());
  await expect(page).toHaveURL(/\/login/);
});
