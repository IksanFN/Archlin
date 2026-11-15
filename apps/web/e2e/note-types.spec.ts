import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { expectNoA11yViolations } from './helpers/a11y';
import { resetAccount } from './helpers/db';
import { completeSetup, gotoSettled, reloadSettled } from './helpers/flows';
import { createNoteType, createSpace } from './helpers/knowledge';

test.beforeEach(async () => {
  await resetAccount();
});

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
  await createNoteType(page, 'Catatan Rapat', [{ label: 'Tanggal', kind: 'date' }, { label: 'Peserta' }]);
  await openNewPage(page, 'Catatan Rapat');

  await page.getByLabel('Peserta', { exact: true }).fill('Budi dan Sari');
  await expect(page.getByText('Tersimpan', { exact: true })).toBeVisible();

  await changeType(page, 'Referensi');
  await expect(page.getByLabel('Peserta', { exact: true })).toBeHidden();
  await expect(page.getByLabel('URL', { exact: true })).toBeVisible();

  await changeType(page, 'Catatan Rapat');
  await expect(page.getByLabel('Peserta', { exact: true })).toHaveValue('Budi dan Sari');
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

test('creates a note type with fields and uses it for a page', async ({ page }) => {
  await completeSetup(page);
  await createSpace(page, 'Kerja');
  await createNoteType(page, 'Catatan Kelas', [{ label: 'Pengajar' }, { label: 'Tanggal kelas', kind: 'date' }]);

  await gotoSettled(page, '/settings/note-types');
  await expect(page.getByRole('link', { name: 'Catatan Kelas' })).toBeVisible();
  await expect(page.getByText('2 field').first()).toBeVisible();

  await openNewPage(page, 'Catatan Kelas');
  await page.getByLabel('Pengajar', { exact: true }).fill('Bu Ratna');
  await expect(page.getByLabel('Tanggal kelas', { exact: true })).toHaveAttribute('type', 'date');
  await expect(page.getByText('Tersimpan', { exact: true })).toBeVisible();
  await reloadSettled(page);
  await expect(page.getByLabel('Pengajar', { exact: true })).toHaveValue('Bu Ratna');
});

test('a saved field keeps its type', async ({ page }) => {
  await completeSetup(page);
  await createNoteType(page, 'Catatan Kelas', [{ label: 'Pengajar' }]);

  await reloadSettled(page);
  const kind = page.getByLabel('Jenis', { exact: true }).first();
  await expect(kind).toBeDisabled();
  await expect(page.getByText('Jenis tidak bisa diubah setelah disimpan. Hapus field lalu buat yang baru.')).toBeVisible();

  await page.getByRole('button', { name: 'Tambah field' }).click();
  await expect(page.getByLabel('Jenis', { exact: true }).nth(1)).toBeEnabled();
});

test('deleting a used type moves its pages first', async ({ page }) => {
  await completeSetup(page);
  await createSpace(page, 'Kerja');
  await createNoteType(page, 'Catatan Kelas', [{ label: 'Pengajar' }]);
  await openNewPage(page, 'Catatan Kelas');
  await page.getByLabel('Pengajar', { exact: true }).fill('Pak Dedi');
  await expect(page.getByText('Tersimpan', { exact: true })).toBeVisible();
  const pageUrl = new URL(page.url()).pathname;

  await gotoSettled(page, '/settings/note-types');
  await page.getByRole('link', { name: 'Catatan Kelas' }).click();
  await page.getByRole('button', { name: 'Hapus tipe' }).click();
  const dialog = page.getByRole('dialog', { name: /Hapus tipe/ });
  const confirm = dialog.getByRole('button', { name: 'Pindahkan dan hapus' });
  await expect(dialog.getByText(/Dipakai 1 halaman, termasuk yang ada di Trash/)).toBeVisible();
  await dialog.getByLabel('Tipe tujuan').selectOption({ label: 'Referensi' });
  await confirm.click();
  await expect(page).toHaveURL(/\/settings\/note-types$/);
  await expect(page.getByRole('link', { name: 'Catatan Kelas' })).toHaveCount(0);

  await gotoSettled(page, pageUrl);
  await expect(page.getByText(/^Referensi · /)).toBeVisible();
  await expect(page.getByLabel('URL', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Pengajar', { exact: true })).toBeHidden();
});

test('changing a page type keeps values of shared keys', async ({ page }) => {
  await completeSetup(page);
  await createSpace(page, 'Kerja');
  await createNoteType(page, 'Catatan Kelas', [{ label: 'Peserta' }, { label: 'Materi' }]);
  await createNoteType(page, 'Catatan Rapat', [{ label: 'Peserta' }, { label: 'Keputusan' }]);
  await openNewPage(page, 'Catatan Kelas');
  await page.getByLabel('Peserta', { exact: true }).fill('Tim operasional');
  await page.getByLabel('Materi', { exact: true }).fill('Pengantar');
  await expect(page.getByText('Tersimpan', { exact: true })).toBeVisible();

  await changeType(page, 'Catatan Rapat');
  await expect(page.getByLabel('Peserta', { exact: true })).toHaveValue('Tim operasional');
  await expect(page.getByLabel('Keputusan', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Materi', { exact: true })).toBeHidden();

  await reloadSettled(page);
  await expect(page.getByLabel('Peserta', { exact: true })).toHaveValue('Tim operasional');
});
