import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { gotoSettled, reloadSettled } from './flows';
import { createNoteType, createPage, createSpace, editorOf, spaceRow, treeRow, waitSaved } from './knowledge';

const CONFLICT_TITLE = 'Halaman ini berubah di tab atau perangkat lain';
const TRASH_BANNER = 'Halaman ini ada di Trash. Isinya hanya bisa dibaca.';

async function rowMenu(page: Page, row: Locator, item: string): Promise<void> {
  await row.getByRole('button', { name: 'Opsi', exact: true }).first().click();
  await page.getByRole('menuitem', { name: item }).click();
}

async function pageMenu(page: Page, item: string): Promise<void> {
  await page.getByRole('button', { name: 'Opsi halaman' }).click();
  await page.getByRole('menuitem', { name: item }).click();
}

async function trashCurrentPage(page: Page): Promise<void> {
  await pageMenu(page, 'Pindahkan ke Trash');
  await expect(page.getByText(TRASH_BANNER)).toBeVisible();
}

async function driveSpaces(page: Page): Promise<{ kerja: string; rumah: string }> {
  const kerja = await createSpace(page, 'Kerja');
  const rumah = await createSpace(page, 'Rumah');

  await rowMenu(page, spaceRow(page, rumah.slug), 'Ganti nama');
  const rename = page.getByRole('dialog', { name: 'Ganti nama space' });
  await rename.getByLabel('Nama').fill('Rumah tangga');
  await rename.getByRole('button', { name: 'Ganti nama', exact: true }).click();
  await expect(rename).toBeHidden();
  await rowMenu(page, spaceRow(page, rumah.slug), 'Naikkan');
  await expect(page.getByRole('link', { name: 'Rumah tangga', exact: true })).toBeVisible();
  return { kerja: kerja.slug, rumah: rumah.slug };
}

async function drivePages(page: Page, space: string): Promise<{ mainUrl: string }> {
  const main = await createPage(page, { space, type: 'Runbook', title: 'Prosedur' });
  await editorOf(page).click();
  await page.keyboard.type('langkah pertama');
  await waitSaved(page);
  await page.getByRole('button', { name: 'Tambah ke favorit' }).click();
  await expect(page.getByRole('button', { name: 'Hapus dari favorit' })).toBeVisible();
  const tags = page.getByRole('combobox', { name: 'Tag', exact: true });
  await tags.fill('ops');
  await tags.press('Enter');
  await expect(page.getByRole('button', { name: 'Hapus tag ops' })).toBeVisible();

  await createPage(page, { space, type: 'Quick Note', title: 'Induk' });
  // The next page is offered the tag the first one got; Enter alone would commit before the suggestions are asked for.
  const nextTags = page.getByRole('combobox', { name: 'Tag', exact: true });
  await nextTags.fill('op');
  await expect(page.getByRole('option', { name: 'ops', exact: true })).toBeVisible();
  await nextTags.press('Escape');
  await createPage(page, { space, parentTitle: 'Induk', type: 'Quick Note', title: 'Anak' });
  await rowMenu(page, treeRow(page, 'Induk'), 'Ubah ikon');
  await page.getByLabel('Ketik atau tempel satu emoji').fill('🚀');
  await page.keyboard.press('Escape');
  await rowMenu(page, treeRow(page, 'Anak'), 'Ganti nama');
  await page.getByRole('textbox', { name: 'Ganti nama' }).fill('Anak baru');
  await page.keyboard.press('Enter');
  await expect(treeRow(page, 'Anak baru')).toBeVisible();

  await pageMenu(page, 'Pindahkan ke…');
  const move = page.getByRole('dialog', { name: /Pindahkan/ });
  await move.getByRole('treeitem', { name: 'Prosedur' }).click();
  await move.getByRole('button', { name: 'Pindahkan', exact: true }).click();
  await expect(move).toBeHidden();

  await pageMenu(page, 'Ubah tipe catatan');
  const change = page.getByRole('dialog', { name: 'Ubah tipe catatan' });
  await change.locator('label', { hasText: 'Referensi' }).click();
  await change.getByRole('button', { name: 'Ubah tipe' }).click();
  await expect(change).toBeHidden();
  return { mainUrl: main.url };
}

// Trash: move, list, restore, then purge one page and empty the rest.
async function driveTrash(page: Page, space: string, mainUrl: string): Promise<void> {
  await trashCurrentPage(page);
  await gotoSettled(page, '/settings/trash');
  await page.getByRole('button', { name: 'Pulihkan' }).click();
  await expect(page.getByRole('heading', { name: 'Trash kosong' })).toBeVisible();

  await gotoSettled(page, mainUrl);
  await trashCurrentPage(page);
  await gotoSettled(page, '/settings/trash');
  await page.getByRole('button', { name: 'Hapus permanen' }).click();
  await page.getByRole('dialog', { name: /selamanya/ }).getByRole('button', { name: 'Hapus permanen' }).click();
  await expect(page.getByRole('heading', { name: 'Trash kosong' })).toBeVisible();

  await createPage(page, { space, type: 'Quick Note', title: 'Cadangan' });
  await trashCurrentPage(page);
  await gotoSettled(page, '/settings/trash');
  await page.getByRole('button', { name: 'Kosongkan Trash' }).click();
  await page.getByRole('dialog', { name: 'Kosongkan Trash?' }).getByRole('button', { name: 'Hapus permanen' }).click();
  await expect(page.getByRole('heading', { name: 'Trash kosong' })).toBeVisible();
}

// Both answers of the conflict dialog: another tab saves first, then this tab loses and picks one.
async function driveConflicts(page: Page, space: string): Promise<void> {
  const live = await createPage(page, { space, type: 'Quick Note', title: 'Bersama' });
  const other = await page.context().newPage();
  try {
    await gotoSettled(other, live.url);
    for (const answer of ['Muat versi terbaru', 'Timpa']) {
      await editorOf(other).click();
      await other.keyboard.type(' dari tab lain');
      await waitSaved(other);
      await editorOf(page).click();
      await page.keyboard.type(' dari tab ini');
      const dialog = page.getByRole('dialog', { name: CONFLICT_TITLE });
      await dialog.getByRole('button', { name: answer }).click();
      await expect(dialog).toBeHidden();
      await waitSaved(page);
      await reloadSettled(other);
    }
  } finally {
    await other.close();
  }
}

async function driveNoteTypes(page: Page): Promise<void> {
  await createNoteType(page, 'Catatan Rapat', [{ label: 'Peserta' }]);

  await gotoSettled(page, '/settings/note-types');
  await page.getByRole('button', { name: 'Naikkan tipe Catatan Rapat' }).click();
  await page.getByRole('link', { name: 'Catatan Rapat' }).click();
  await page.getByRole('button', { name: 'Hapus tipe' }).click();
  await page.getByRole('dialog', { name: /Hapus tipe/ }).getByRole('button', { name: 'Hapus', exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/note-types$/);
}

async function driveArchive(page: Page, rumah: string): Promise<void> {
  await rowMenu(page, spaceRow(page, rumah), 'Arsipkan');
  await expect(spaceRow(page, rumah)).toBeHidden();
  await page.getByRole('button', { name: 'Opsi space' }).click();
  await page.getByRole('menuitem', { name: 'Space yang diarsipkan' }).click();
  await page.getByRole('dialog', { name: 'Space yang diarsipkan' }).getByRole('button', { name: 'Kembalikan' }).click();
  await page.keyboard.press('Escape');
  await expect(spaceRow(page, rumah)).toBeVisible();
}

// Walks every knowledge screen action once, so a recorder attached to the page sees each server function those screens call.
export async function driveKnowledgeFlows(page: Page): Promise<void> {
  const slugs = await driveSpaces(page);
  const { mainUrl } = await drivePages(page, slugs.kerja);
  await driveTrash(page, slugs.kerja, mainUrl);
  await driveConflicts(page, slugs.kerja);
  await driveNoteTypes(page);
  await driveArchive(page, slugs.rumah);
}
