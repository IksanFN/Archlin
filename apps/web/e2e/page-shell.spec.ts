import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { resetAccount } from './helpers/db';
import { completeSetup, gotoSettled, reloadSettled } from './helpers/flows';

test.beforeEach(async () => {
  await resetAccount();
});

async function createSpace(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Buat space' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Buat space' });
  await dialog.getByLabel('Nama').fill(name);
  await dialog.getByRole('button', { name: 'Buat space' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
}

async function createRootPage(page: Page, spaceSlug: string): Promise<string> {
  await page.getByRole('main').getByRole('button', { name: 'Halaman baru' }).first().click();
  await page.getByRole('menuitem', { name: 'Quick Note' }).click();
  await expect(page).toHaveURL(new RegExp(`/s/${spaceSlug}/p/`));
  const entityId = new URL(page.url()).pathname.split('/').at(-1);
  if (entityId === undefined || entityId === '') throw new Error('expected a page id in the url');
  await expect(page.getByRole('heading', { name: 'Tanpa judul', level: 1 })).toBeVisible();
  return entityId;
}

test('opens a page from the tree with its breadcrumb', async ({ page }) => {
  await completeSetup(page);
  await createSpace(page, 'Kerja');
  const entityId = await createRootPage(page, 'kerja');

  await gotoSettled(page, `/s/kerja`);
  await page.getByRole('treeitem', { name: /Tanpa judul/ }).getByRole('link', { name: 'Tanpa judul' }).click();
  await expect(page).toHaveURL(new RegExp(`/s/kerja/p/${entityId}`));

  const crumb = page.getByRole('navigation', { name: 'Jalur halaman' });
  await expect(crumb.getByRole('link', { name: 'Kerja' })).toBeVisible();
  await expect(crumb).toContainText('Tanpa judul');
  await expect(page.getByRole('heading', { name: 'Tanpa judul', level: 1 })).toBeVisible();
});

test('redirects a page url with a stale space slug to the canonical one', async ({ page }) => {
  await completeSetup(page);
  await createSpace(page, 'Kerja');
  await createSpace(page, 'Rumah');
  await gotoSettled(page, '/s/kerja');
  const entityId = await createRootPage(page, 'kerja');

  await page.getByRole('button', { name: 'Opsi halaman' }).click();
  await page.getByRole('menuitem', { name: 'Pindahkan ke…' }).click();
  const dialog = page.getByRole('dialog', { name: /Pindahkan/ });
  await dialog.getByRole('combobox', { name: 'Space' }).selectOption({ label: 'Rumah' });
  await dialog.getByRole('button', { name: 'Pindahkan' }).click();
  await expect(dialog).toBeHidden();

  await gotoSettled(page, `/s/kerja/p/${entityId}`);
  await expect(page).toHaveURL(new RegExp(`/s/rumah/p/${entityId}$`));
});

test('an unknown page id shows not found', async ({ page }) => {
  await completeSetup(page);
  await gotoSettled(page, '/s/kerja/p/00000000-0000-4000-8000-000000000000');
  await expect(page.getByRole('heading', { name: 'Halaman tidak ditemukan', level: 1 })).toBeVisible();
  await expect(page.getByText('Alamat ini tidak ada di Archlin.')).toBeVisible();
});

test('a page in trash shows the banner and restores', async ({ page }) => {
  await completeSetup(page);
  await createSpace(page, 'Kerja');
  await createRootPage(page, 'kerja');

  await page.getByRole('button', { name: 'Opsi halaman' }).click();
  await page.getByRole('menuitem', { name: 'Pindahkan ke Trash' }).click();
  await expect(page.getByText('Halaman ini ada di Trash. Isinya hanya bisa dibaca.')).toBeVisible();

  await page.getByRole('button', { name: 'Pulihkan' }).click();
  await expect(page.getByText('Halaman ini ada di Trash. Isinya hanya bisa dibaca.')).toBeHidden();
  await expect(page.getByText('Dipulihkan.')).toBeVisible();

  await reloadSettled(page);
  await expect(page.getByRole('treeitem', { name: /Tanpa judul/ })).toBeVisible();
});

test('the star toggles the favorites section', async ({ page }) => {
  await completeSetup(page);
  await createSpace(page, 'Kerja');
  await createRootPage(page, 'kerja');

  await page.getByRole('button', { name: 'Tambah ke favorit' }).click();
  await expect(page.getByRole('button', { name: 'Hapus dari favorit' })).toHaveAttribute('aria-pressed', 'true');

  await reloadSettled(page);
  await expect(page.getByText('Favorit', { exact: true })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Navigasi utama' }).getByRole('link', { name: 'Tanpa judul' })).toHaveCount(2);

  await page.getByRole('button', { name: 'Hapus dari favorit' }).click();
  await expect(page.getByRole('button', { name: 'Tambah ke favorit' })).toHaveAttribute('aria-pressed', 'false');

  await reloadSettled(page);
  await expect(page.getByText('Favorit', { exact: true })).toBeHidden();
});
