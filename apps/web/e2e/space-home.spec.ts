import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { resetAccount } from './helpers/db';
import { completeSetup, gotoSettled, reloadSettled } from './helpers/flows';
import { createPage, createSpace as createSpaceNamed, waitSaved } from './helpers/knowledge';

test.beforeEach(async () => {
  await resetAccount();
});

async function createSpace(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Buat space' }).filter({ hasText: 'Buat space' }).click();
  const dialog = page.getByRole('dialog', { name: 'Buat space' });
  await dialog.getByLabel('Nama').fill(name);
  await dialog.getByRole('button', { name: 'Buat space' }).click();
  await expect(dialog).toBeHidden();
}

async function createRootPage(page: Page, spaceSlug: string): Promise<void> {
  await page.getByRole('main').getByRole('button', { name: 'Halaman baru' }).first().click();
  await page.getByRole('menuitem', { name: 'Quick Note' }).click();
  await expect(page).toHaveURL(new RegExp(`/s/${spaceSlug}/p/`));
  await gotoSettled(page, `/s/${spaceSlug}`);
  await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();
}

test('space home lists root pages and the latest changes', async ({ page }) => {
  await completeSetup(page);
  await createSpace(page, 'Kerja');
  await gotoSettled(page, '/s/kerja');
  await createRootPage(page, 'kerja');
  await createRootPage(page, 'kerja');

  await expect(page.getByRole('heading', { name: 'Kerja', level: 1 })).toBeVisible();
  const roots = page.getByRole('region', { name: 'Halaman akar' });
  await expect(roots.getByRole('link')).toHaveCount(2);
  await expect(roots.getByRole('link').nth(0)).toContainText('Tanpa judul');
  await expect(roots.getByRole('link').nth(1)).toContainText('Tanpa judul');

  const recent = page.getByRole('region', { name: 'Baru diubah' });
  await expect(recent.getByRole('link')).toHaveCount(2);
  await expect(recent.getByRole('link').nth(0)).toContainText('Tanpa judul');
  await expect(recent.getByRole('link').nth(1)).toContainText('Tanpa judul');
  await expect(recent.getByRole('link').nth(0)).toContainText(/baru saja|\d+ menit lalu|\d+ jam lalu/);
  await expect(recent.getByRole('link').nth(1)).toContainText(/baru saja|\d+ menit lalu|\d+ jam lalu/);
});

test('an empty space offers the first page', async ({ page }) => {
  await completeSetup(page);
  await createSpace(page, 'Kerja');
  await gotoSettled(page, '/s/kerja');

  await expect(page.getByRole('heading', { name: 'Kerja', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Space ini masih kosong' })).toBeVisible();
  await expect(page.getByText('Buat halaman pertama untuk mulai mencatat.')).toBeVisible();
  await expect(page.getByRole('main').getByRole('button', { name: 'Halaman baru' }).first()).toBeVisible();
});

test('an archived space shows the notice and can be restored', async ({ page }) => {
  await completeSetup(page);
  await createSpace(page, 'Kerja');
  await gotoSettled(page, '/s/kerja');
  await expect(page.getByRole('heading', { name: 'Kerja', level: 1 })).toBeVisible();

  const spaceRow = page.getByRole('treeitem', { name: /Kerja/ });
  await spaceRow.getByRole('link', { name: 'Kerja' }).click({ button: 'right' });
  const archive = page.getByRole('menuitem', { name: 'Arsipkan' });
  await expect(archive).toBeVisible();
  // The portaled row menu can sit outside the viewport, so a pointer click is rejected.
  await archive.press('Enter');
  await expect(spaceRow).toBeHidden();
  // The tree drops the row before the server has answered, so the toast is the sign that the archive is committed.
  await expect(page.getByText('Space “Kerja” diarsipkan.')).toBeVisible();

  await gotoSettled(page, '/s/kerja');
  await expect(page.getByText('Space ini diarsipkan dan tidak tampil di sidebar.')).toBeVisible();
  await page.getByRole('button', { name: 'Kembalikan' }).click();
  await expect(page.getByText('Space ini diarsipkan dan tidak tampil di sidebar.')).toBeHidden();

  await reloadSettled(page);
  await expect(page.getByRole('treeitem', { name: /Kerja/ })).toBeVisible();
});

test('space home shows the summary of a root page', async ({ page }) => {
  await completeSetup(page);
  const { slug } = await createSpaceNamed(page, 'Kerja');
  await createPage(page, { space: slug, type: 'Runbook', title: 'Pulihkan tagihan' });
  await page.getByLabel('Ringkasan', { exact: true }).fill('Langkah memulihkan layanan tagihan setelah gagal rilis');
  await waitSaved(page);

  await gotoSettled(page, `/s/${slug}`);
  const roots = page.getByRole('region', { name: 'Halaman akar' });
  const row = roots.getByRole('link', { name: /Pulihkan tagihan/ });
  await expect(row).toContainText('Langkah memulihkan layanan tagihan setelah gagal rilis');
});
