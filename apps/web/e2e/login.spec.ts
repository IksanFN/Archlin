import { expect, test } from '@playwright/test';
import { ACCOUNT, completeSetup, signIn, signOut, submitLogin, gotoSettled, reloadSettled } from './helpers/flows';
import { resetAccount } from './helpers/db';

test.beforeEach(async ({ page }) => {
  await resetAccount();
  await completeSetup(page);
  await signOut(page);
});

test('signs in and out', async ({ page }) => {
  await signIn(page);
  await signOut(page);
  await expect(page).toHaveURL('/login');
});

test('wrong password shows a generic error', async ({ page }) => {
  await submitLogin(page, 'password-yang-salah-123');
  await expect(page.getByText('Email atau password salah.')).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test('locks after five failures', async ({ page }) => {
  await gotoSettled(page, '/login');
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    await page.getByLabel('Email').fill(ACCOUNT.email);
    await page.getByLabel('Password', { exact: true }).fill(`salah-${attempt}-0123456789`);
    await page.getByRole('button', { name: 'Masuk' }).click();
    await expect(page.getByText('Email atau password salah.')).toBeVisible();
  }
  await page.getByLabel('Password', { exact: true }).fill(ACCOUNT.password);
  await page.getByRole('button', { name: 'Masuk' }).click();
  await expect(page.getByText('Terlalu banyak percobaan. Coba lagi dalam 15 menit.')).toBeVisible();
});

test('keeps the session cookie on http localhost', async ({ page, context }) => {
  await signIn(page);
  await reloadSettled(page);
  await expect(page).toHaveURL('/');
  const cookie = (await context.cookies()).find((candidate) => candidate.name === '__Host-archlin_session');
  expect(cookie).toBeDefined();
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.secure).toBe(true);
  expect(cookie?.sameSite).toBe('Lax');
});
