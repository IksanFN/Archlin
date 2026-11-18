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

test('login field padding and icons focus the input without intercepting password controls', async ({ page }) => {
  await gotoSettled(page, '/login');
  for (const label of ['Email', 'Password']) {
    const input = page.getByLabel(label, { exact: true });
    const frame = input.locator('..');
    const box = await frame.boundingBox();
    const icon = await frame.locator('svg').first().boundingBox();
    if (box === null || icon === null) throw new Error('The login field and its icon must be visible');
    for (const point of [
      { x: box.x + 4, y: box.y + box.height - 4 },
      { x: icon.x + icon.width / 2, y: icon.y + icon.height / 2 },
    ]) {
      await page.getByRole('heading', { level: 1 }).click();
      await page.mouse.click(point.x, point.y);
      await expect(input).toBeFocused();
    }
  }
  const password = page.getByLabel('Password', { exact: true });
  await password.fill('synthetic-password');
  const show = page.getByRole('button', { name: 'Tampilkan password' });
  if (await page.evaluate(() => matchMedia('(pointer: coarse)').matches)) {
    const box = await show.boundingBox();
    if (box === null) throw new Error('Password toggle must be visible');
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    await page.touchscreen.tap(box.x + 1, box.y + box.height / 2);
    await expect(password).toHaveAttribute('type', 'text');
    const inputBox = await password.boundingBox();
    if (inputBox === null) throw new Error('Password input must be visible');
    await page.touchscreen.tap(inputBox.x + inputBox.width - 1, inputBox.y + inputBox.height / 2);
    await expect(password).toBeFocused();
    await expect(password).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: 'Sembunyikan password' }).click();
  }
  await show.click();
  await expect(password).toHaveAttribute('type', 'text');
  await expect(password).not.toBeFocused();
  await expect(page).toHaveURL(/\/login/);
  await page.getByRole('button', { name: 'Sembunyikan password' }).click();
  await expect(password).toHaveAttribute('type', 'password');
  await expect(password).toHaveValue('synthetic-password');
});
