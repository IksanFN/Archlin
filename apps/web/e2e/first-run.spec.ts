import { expect, test } from '@playwright/test';
import { ACCOUNT, completeSetup, fillSetupForm, gotoSettled } from './helpers/flows';
import { resetAccount, userCount } from './helpers/db';

test.beforeEach(async () => {
  await resetAccount();
});

test('redirects a new install to setup', async ({ page }) => {
  await gotoSettled(page, '/');
  await expect(page).toHaveURL('/setup');
});

test('rejects a wrong setup code', async ({ page }) => {
  await gotoSettled(page, '/setup');
  await fillSetupForm(page, 'bukan-kode-setup-yang-benar');
  await page.getByRole('button', { name: 'Buat akun' }).click();
  await expect(page.getByText('Kode setup tidak cocok.')).toBeVisible();
  expect(await userCount()).toBe(0);
});

test('double submit creates one account', async ({ browser }) => {
  // Two separate browsers stand in for two tabs: they share no cookies, so the loser really meets the conflict.
  const first = await browser.newContext();
  const second = await browser.newContext();
  const pages = [await first.newPage(), await second.newPage()];
  try {
    for (const page of pages) {
      await gotoSettled(page, '/setup');
      await fillSetupForm(page);
    }
    await Promise.all(pages.map((page) => page.getByRole('button', { name: 'Buat akun' }).dblclick()));
    await Promise.all(pages.map((page) => expect(page).toHaveURL(/\/$|\/login\?alasan=sudah-disiapkan$/)));

    const urls = pages.map((page) => new URL(page.url()));
    expect(urls.filter((url) => url.pathname === '/')).toHaveLength(1);
    const loser = urls.find((url) => url.pathname === '/login');
    expect(loser?.searchParams.get('alasan')).toBe('sudah-disiapkan');
    expect(await userCount()).toBe(1);
  } finally {
    await first.close();
    await second.close();
  }
});

test('lands on today after setup', async ({ page }) => {
  await completeSetup(page);
  const today = new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Jakarta' }).format(new Date());
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(today);
  await expect(page.getByText(new RegExp(`^Selamat (pagi|siang|sore|malam), ${ACCOUNT.name}\\.$`))).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Belum ada yang perlu dilihat hari ini' })).toBeVisible();
  const sidebar = page.getByRole('complementary', { name: 'Navigasi utama' });
  await expect(sidebar).not.toContainText('Inbox');
  await expect(sidebar).not.toContainText('Cari');
});
