import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { resetAccount } from './helpers/db';
import { completeSetup, gotoSettled, signIn } from './helpers/flows';
import { advanceClock } from './helpers/totp';

const DAY_MS = 24 * 60 * 60 * 1000;

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
  await gotoSettled(page, `/s/${spaceSlug}`);
  await page.getByRole('main').getByRole('button', { name: 'Halaman baru' }).first().click();
  await page.getByRole('menuitem', { name: 'Quick Note' }).click();
  await expect(page).toHaveURL(new RegExp(`/s/${spaceSlug}/p/`));
  const entityId = new URL(page.url()).pathname.split('/').at(-1);
  if (entityId === undefined || entityId === '') throw new Error('expected a page id in the url');
  await expect(page.getByRole('heading', { name: 'Tanpa judul', level: 1 })).toBeVisible();
  return entityId;
}

async function trashCurrentPage(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Opsi halaman' }).click();
  await page.getByRole('menuitem', { name: 'Pindahkan ke Trash' }).click();
  await expect(page.getByText('Halaman ini ada di Trash. Isinya hanya bisa dibaca.')).toBeVisible();
}

async function moveCurrentUnderUntitled(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Opsi halaman' }).click();
  await page.getByRole('menuitem', { name: 'Pindahkan ke…' }).click();
  const dialog = page.getByRole('dialog', { name: /Pindahkan/ });
  const options = dialog.getByRole('treeitem', { name: 'Tanpa judul' });
  const count = await options.count();
  for (let i = 0; i < count; i += 1) {
    const option = options.nth(i);
    if ((await option.getAttribute('aria-disabled')) === 'true') continue;
    await option.click();
    break;
  }
  await dialog.getByRole('button', { name: 'Pindahkan' }).click();
  await expect(dialog).toBeHidden();
}

async function openTrash(page: Page): Promise<void> {
  await gotoSettled(page, '/settings/trash');
  await expect(page.getByRole('heading', { name: 'Trash', level: 1 })).toBeVisible();
}

test('lists trashed roots with the days left and restores one', async ({ page }) => {
  await completeSetup(page);
  await createSpace(page, 'Kerja');
  await createRootPage(page, 'kerja');
  await trashCurrentPage(page);

  await openTrash(page);
  await expect(page.getByRole('link', { name: 'Trash' })).toBeVisible();
  await expect(page.getByText('Tanpa judul').first()).toBeVisible();
  await expect(page.getByText('Kerja', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Terhapus permanen dalam 30 hari')).toBeVisible();

  await page.getByRole('button', { name: 'Pulihkan' }).click();
  await expect(page.getByRole('heading', { name: 'Trash kosong' })).toBeVisible();
  await expect(page.getByText(/Dipulihkan ke/)).toBeVisible();

  await page.getByRole('button', { name: 'Buka' }).click();
  await expect(page).toHaveURL(/\/s\/kerja\/p\//);
  await expect(page.getByText('Halaman ini ada di Trash. Isinya hanya bisa dibaca.')).toBeHidden();
});

test('restoring a child whose parent is still in trash lands at the space root', async ({ page }) => {
  await completeSetup(page);
  await createSpace(page, 'Kerja');
  await createRootPage(page, 'kerja');
  await createRootPage(page, 'kerja');
  await moveCurrentUnderUntitled(page);
  await trashCurrentPage(page);

  await gotoSettled(page, '/s/kerja');
  await page.getByRole('region', { name: 'Halaman akar' }).getByRole('link').click();
  await expect(page.getByRole('heading', { name: 'Tanpa judul', level: 1 })).toBeVisible();
  await trashCurrentPage(page);

  await openTrash(page);
  const child = page.getByRole('listitem').filter({ hasText: 'Kerja /' });
  await child.getByRole('button', { name: 'Pulihkan' }).click();
  await expect(page.getByText('Dipulihkan ke akar Kerja karena induknya masih di Trash.')).toBeVisible();

  await page.getByRole('button', { name: 'Buka' }).click();
  await expect(page).toHaveURL(/\/s\/kerja\/p\//);
  const crumb = page.getByRole('navigation', { name: 'Jalur halaman' });
  await expect(crumb.getByRole('link', { name: 'Kerja' })).toBeVisible();
  await expect(crumb.getByRole('link')).toHaveCount(1);
});

test('permanent delete asks first and removes the subtree', async ({ page }) => {
  await completeSetup(page);
  await createSpace(page, 'Kerja');
  await createRootPage(page, 'kerja');
  await createRootPage(page, 'kerja');
  await moveCurrentUnderUntitled(page);

  await gotoSettled(page, '/s/kerja');
  await page.getByRole('region', { name: 'Halaman akar' }).getByRole('link').click();
  await trashCurrentPage(page);

  await openTrash(page);
  await expect(page.getByText('1 sub-halaman')).toBeVisible();
  await page.getByRole('button', { name: 'Hapus permanen' }).click();

  const dialog = page.getByRole('dialog', { name: 'Hapus “Tanpa judul” selamanya?' });
  await expect(dialog.getByText('1 sub-halaman ikut terhapus. Tindakan ini tidak bisa dibatalkan.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Batal' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Tanpa judul').first()).toBeVisible();

  await page.getByRole('button', { name: 'Hapus permanen' }).click();
  await page.getByRole('dialog', { name: 'Hapus “Tanpa judul” selamanya?' }).getByRole('button', { name: 'Hapus permanen' }).click();
  await expect(page.getByRole('heading', { name: 'Trash kosong' })).toBeVisible();
});

test('empty trash removes everything after confirming', async ({ page }) => {
  await completeSetup(page);
  await createSpace(page, 'Kerja');
  await createRootPage(page, 'kerja');
  await trashCurrentPage(page);
  await createRootPage(page, 'kerja');
  await trashCurrentPage(page);

  await openTrash(page);
  await page.getByRole('button', { name: 'Kosongkan Trash' }).click();
  const dialog = page.getByRole('dialog', { name: 'Kosongkan Trash?' });
  await expect(dialog.getByText('2 halaman di Trash akan dihapus. Tindakan ini tidak bisa dibatalkan.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Hapus permanen' }).click();
  await expect(page.getByRole('heading', { name: 'Trash kosong' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Kosongkan Trash' })).toBeDisabled();
});

test('an entry three days from purge is marked', async ({ page, request }) => {
  await completeSetup(page);
  await createSpace(page, 'Kerja');
  await createRootPage(page, 'kerja');
  await trashCurrentPage(page);

  await advanceClock(request, 27 * DAY_MS);
  await gotoSettled(page, '/settings/trash');
  await expect(page).toHaveURL(/\/login/);
  await signIn(page);
  await openTrash(page);
  await expect(page.getByText(/Terhapus permanen dalam \d+ hari/)).toHaveClass(/text-attention/);
});
