import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { expectNoA11yViolations } from './helpers/a11y';
import { resetAccount } from './helpers/db';
import { completeSetup, gotoSettled } from './helpers/flows';

test.beforeEach(async () => {
  await resetAccount();
});

async function createSpace(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Buat space' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Buat space' });
  await dialog.getByLabel('Nama').fill(name);
  await dialog.getByRole('button', { name: 'Buat space' }).click();
  await expect(dialog).toBeHidden();
}

async function createMeetingType(page: Page): Promise<void> {
  await gotoSettled(page, '/settings/note-types');
  await page.getByRole('button', { name: 'Tipe baru' }).click();
  const dialog = page.getByRole('dialog', { name: 'Tipe baru' });
  await dialog.getByLabel('Nama').fill('Catatan Rapat');
  await dialog.getByRole('button', { name: 'Buat tipe' }).click();
  await expect(page).toHaveURL(/\/settings\/note-types\/[0-9a-f-]{36}$/);

  await page.getByRole('button', { name: 'Tambah field' }).click();
  await page.getByLabel('Label', { exact: true }).first().fill('Tanggal');
  await page.getByLabel('Jenis', { exact: true }).first().selectOption('date');
  await page.getByRole('button', { name: 'Tambah field' }).click();
  await page.getByLabel('Label', { exact: true }).nth(1).fill('Peserta');
  await page.getByRole('button', { name: 'Simpan perubahan' }).click();
  await expect(page.getByRole('button', { name: 'Simpan perubahan' })).toBeHidden();
}

async function openNewPage(page: Page, noteType: string): Promise<void> {
  await gotoSettled(page, '/s/kerja');
  await page.getByRole('main').getByRole('button', { name: 'Halaman baru' }).first().click();
  await page.getByRole('menuitem', { name: noteType }).click();
  await expect(page).toHaveURL(/\/s\/kerja\/p\//);
  await expect(page.getByRole('button', { name: 'Kartu Konteks' })).toBeVisible();
}

async function changeType(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Opsi halaman' }).click();
  await page.getByRole('menuitem', { name: 'Ubah tipe catatan' }).click();
  const dialog = page.getByRole('dialog', { name: 'Ubah tipe catatan' });
  await dialog.locator('label', { hasText: name }).click();
  await dialog.getByRole('button', { name: 'Ubah tipe' }).click();
  await expect(dialog).toBeHidden();
}

test('a custom type adds fields to a page and its values survive a type change and back', async ({ page }) => {
  await completeSetup(page);
  await createSpace(page, 'Kerja');
  await createMeetingType(page);
  await openNewPage(page, 'Catatan Rapat');

  await page.getByLabel('Peserta', { exact: true }).fill('Budi dan Sari');
  await expect(page.getByText('Tersimpan', { exact: true })).toBeVisible();

  await changeType(page, 'Referensi');
  await expect(page.getByLabel('Peserta', { exact: true })).toBeHidden();
  await expect(page.getByLabel('URL', { exact: true })).toBeVisible();

  await changeType(page, 'Catatan Rapat');
  await expect(page.getByLabel('Peserta', { exact: true })).toHaveValue('Budi dan Sari');
});

test('deleting a type that has pages moves them to the chosen type', async ({ page }) => {
  await completeSetup(page);
  await createSpace(page, 'Kerja');
  await createMeetingType(page);
  await openNewPage(page, 'Catatan Rapat');
  await expect(page.getByLabel('Peserta', { exact: true })).toBeVisible();

  await gotoSettled(page, '/settings/note-types');
  await page.getByRole('link', { name: 'Catatan Rapat' }).click();
  await page.getByRole('button', { name: 'Hapus tipe' }).click();
  const dialog = page.getByRole('dialog', { name: /Hapus tipe/ });
  await expect(dialog.getByText(/Dipakai 1 halaman, termasuk yang ada di Trash/)).toBeVisible();
  await dialog.getByLabel('Tipe tujuan').selectOption({ label: 'Quick Note' });
  await dialog.getByRole('button', { name: 'Pindahkan dan hapus' }).click();

  await expect(page).toHaveURL(/\/settings\/note-types$/);
  await expect(page.getByRole('link', { name: 'Catatan Rapat' })).toHaveCount(0);
});

test('leaving the type editor with unsaved changes asks first', async ({ page }) => {
  await completeSetup(page);
  await gotoSettled(page, '/settings/note-types');
  await page.getByRole('link', { name: 'Quick Note' }).click();
  await page.getByLabel('Nama tipe', { exact: true }).fill('Quick Note 2');

  await page.getByRole('link', { name: 'Semua tipe' }).click();
  const dialog = page.getByRole('dialog', { name: 'Buang perubahan yang belum disimpan?' });
  await dialog.getByRole('button', { name: 'Batal' }).click();
  await expect(page.getByLabel('Nama tipe', { exact: true })).toHaveValue('Quick Note 2');

  await page.getByRole('link', { name: 'Semua tipe' }).click();
  await dialog.getByRole('button', { name: 'Buang' }).click();
  await expect(page).toHaveURL(/\/settings\/note-types$/);
  await expect(page.getByRole('link', { name: 'Quick Note', exact: true })).toBeVisible();
});

test('a type moves up and down the list', async ({ page }) => {
  await completeSetup(page);
  await gotoSettled(page, '/settings/note-types');
  const names = page.locator('main li a');
  const before = await names.allInnerTexts();
  const second = before[1];
  if (second === undefined) throw new Error('expected at least two types');

  await page.getByRole('button', { name: `Naikkan tipe ${second}` }).click();
  await expect(names.first()).toHaveText(second);
});

test('the type list and the type editor have no axe violations', async ({ page }) => {
  await completeSetup(page);
  await gotoSettled(page, '/settings/note-types');
  await expectNoA11yViolations(page);
  await page.getByRole('link', { name: 'Runbook' }).click();
  await expect(page.getByLabel('Nama tipe', { exact: true })).toBeVisible();
  await expectNoA11yViolations(page);
});
