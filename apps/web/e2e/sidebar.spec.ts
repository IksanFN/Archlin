import { expect, test } from '@playwright/test';
import { resetAccount } from './helpers/db';
import { completeSetup, reloadSettled } from './helpers/flows';

test.beforeEach(async () => {
  await resetAccount();
});

test('a collapsed sidebar stays as an icon rail with tooltips and survives a reload', async ({ page }) => {
  await completeSetup(page);
  const aside = page.getByRole('complementary', { name: 'Navigasi utama' });
  await expect(aside.getByText('Belum ada space.')).toBeVisible();

  await aside.getByRole('button', { name: 'Sembunyikan sidebar' }).click();
  await expect.poll(async () => (await aside.boundingBox())?.width).toBe(72);
  await expect(aside.getByText('Belum ada space.')).toBeHidden();

  const today = aside.getByRole('link', { name: 'Hari ini' });
  const settings = aside.getByRole('link', { name: 'Pengaturan' });
  await expect(today).toBeVisible();
  await expect(settings).toBeVisible();
  expect((await today.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);

  await today.hover();
  await expect(page.getByRole('tooltip', { name: 'Hari ini' })).toBeVisible();

  // Keyboard focus must open the tooltip as well; the rail is no icon-only guesswork for keyboard users.
  await page.mouse.move(600, 400);
  await settings.focus();
  await expect(page.getByRole('tooltip', { name: 'Pengaturan' })).toBeVisible();

  await reloadSettled(page);
  await expect.poll(async () => (await aside.boundingBox())?.width).toBe(72);

  await aside.getByRole('button', { name: 'Tampilkan sidebar' }).click();
  await expect.poll(async () => (await aside.boundingBox())?.width).toBe(300);
  await expect(aside.getByText('Belum ada space.')).toBeVisible();
});

test('placeholders say what goes into the first-run fields', async ({ page }) => {
  await page.goto('/setup');
  await expect(page.getByLabel('Nama', { exact: true })).toHaveAttribute('placeholder', 'Nama yang tampil di sapaan');
  await expect(page.getByLabel('Email')).toHaveAttribute('placeholder', 'nama@example.com');
  await expect(page.getByRole('textbox', { name: 'Password' })).toHaveAttribute('placeholder', 'Minimal 12 karakter');
  await expect(page.getByLabel('Kode setup')).toHaveAttribute('placeholder', 'Tempel kode setup');
  await expect(page.getByText(/\.env|ARCHLIN_SETUP_TOKEN/)).toHaveCount(0);
});
