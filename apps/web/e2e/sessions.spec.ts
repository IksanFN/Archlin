import { expect, test } from '@playwright/test';
import { completeSetup, signIn, gotoSettled, reloadSettled } from './helpers/flows';
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
  await reloadSettled(page);
  await expect(page).toHaveURL(/\/login/);
});
