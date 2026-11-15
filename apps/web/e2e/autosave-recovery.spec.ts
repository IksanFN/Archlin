import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { resetAccount } from './helpers/db';
import { completeSetup, gotoSettled, reloadSettled, signIn, signOut } from './helpers/flows';

const SAVE_FUNCTION = '**/_serverFn/kb-save-page';
const CONFLICT_TITLE = 'Halaman ini berubah di tab atau perangkat lain';
const DRAFT_BANNER = /Ada perubahan yang belum tersimpan dari/;

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

async function openNewPage(page: Page): Promise<string> {
  await completeSetup(page);
  await createSpace(page, 'Kerja');
  await page.getByRole('main').getByRole('button', { name: 'Halaman baru' }).first().click();
  await page.getByRole('menuitem', { name: 'Quick Note' }).click();
  await expect(page).toHaveURL(/\/s\/kerja\/p\//);
  await expect(page.getByRole('textbox', { name: 'Isi halaman' })).toBeVisible();
  const entityId = new URL(page.url()).pathname.split('/').at(-1);
  if (entityId === undefined || entityId === '') throw new Error('expected a page id in the url');
  return entityId;
}

const editorOf = (page: Page) => page.getByRole('textbox', { name: 'Isi halaman' });

async function typeInEditor(page: Page, text: string): Promise<void> {
  await editorOf(page).click();
  await page.keyboard.type(text);
}

// A synthetic paste with its own DataTransfer is the only way to paste HTML without the OS clipboard.
async function pasteHtml(page: Page, html: string): Promise<void> {
  await editorOf(page).click();
  await page.evaluate((value) => {
    const data = new DataTransfer();
    data.setData('text/html', value);
    const target = document.querySelector('.ProseMirror');
    target?.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, html);
}

// The row menu is anchored to a hidden trigger and opens off screen, so rows are driven by their keyboard shortcuts.
async function focusTreeRow(page: Page): Promise<void> {
  await page.getByRole('treeitem', { name: /Tanpa judul/ }).getByRole('link', { name: 'Tanpa judul' }).focus();
}

const savedLabel = (page: Page) => page.getByText('Tersimpan', { exact: true });

test('a pasted http image is dropped and the page keeps saving', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'A synthetic paste event delivers no clipboard data to the editor in Firefox');
  await openNewPage(page);
  await pasteHtml(page, '<p>Langkah satu</p><img src="http://contoh.id/a.png">');

  await expect(editorOf(page)).toContainText('Langkah satu');
  await expect(editorOf(page).locator('img')).toHaveCount(0);
  await expect(savedLabel(page)).toBeVisible();

  await reloadSettled(page);
  await expect(editorOf(page)).toContainText('Langkah satu');
  await expect(editorOf(page).locator('img')).toHaveCount(0);
});

test('undo after trashing a page mid-edit brings the editor back and saves the text', async ({ page }) => {
  await openNewPage(page);
  await typeInEditor(page, 'Draf penting');

  await focusTreeRow(page);
  await page.keyboard.press('Delete');
  await expect(page.getByText('Halaman ini ada di Trash. Isinya hanya bisa dibaca.')).toBeVisible();

  await page.getByRole('button', { name: 'Batalkan' }).click();
  await expect(page.getByText('Halaman ini ada di Trash. Isinya hanya bisa dibaca.')).toBeHidden();
  await expect(page.getByRole('textbox', { name: 'Judul' })).toBeEditable();
  await expect(savedLabel(page)).toBeVisible();

  await reloadSettled(page);
  await expect(editorOf(page)).toContainText('Draf penting');
});

test('renaming the open page from the sidebar does not open the conflict dialog', async ({ page }) => {
  await openNewPage(page);

  await focusTreeRow(page);
  await page.keyboard.press('F2');
  await page.getByRole('textbox', { name: 'Ganti nama' }).fill('Nama baru');
  await page.keyboard.press('Enter');

  await expect(page.getByRole('textbox', { name: 'Judul' })).toHaveValue('Nama baru');
  await typeInEditor(page, 'isi sesudah ganti nama');
  await expect(savedLabel(page)).toBeVisible();
  await expect(page.getByText(CONFLICT_TITLE)).toBeHidden();
});

test('changing the type then typing does not open the conflict dialog', async ({ page }) => {
  await openNewPage(page);
  await typeInEditor(page, 'sebelum ubah tipe');

  await page.getByRole('button', { name: 'Opsi halaman' }).click();
  await page.getByRole('menuitem', { name: 'Ubah tipe catatan' }).click();
  const dialog = page.getByRole('dialog', { name: 'Ubah tipe catatan' });
  await dialog.locator('label', { hasText: 'Runbook' }).click();
  await dialog.getByRole('button', { name: 'Ubah tipe' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/Runbook/).first()).toBeVisible();

  await typeInEditor(page, ' sesudah');
  await expect(savedLabel(page)).toBeVisible();
  await expect(page.getByText(CONFLICT_TITLE)).toBeHidden();
});

test('a save whose response was lost does not open the conflict dialog when typing continues', async ({ page }) => {
  const entityId = await openNewPage(page);
  // The first save reaches the server and commits, but the browser never sees the answer.
  await page.route(
    SAVE_FUNCTION,
    async (route) => {
      await route.fetch();
      await route.abort('failed');
    },
    { times: 1 },
  );

  const firstSave = page.waitForRequest(SAVE_FUNCTION);
  await typeInEditor(page, 'satu');
  await firstSave;
  await page.keyboard.type(' dua');

  await expect(savedLabel(page)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(CONFLICT_TITLE)).toBeHidden();

  await gotoSettled(page, `/s/kerja/p/${entityId}`);
  await expect(editorOf(page)).toContainText('satu dua');
});

test('no draft banner for this tab while saves fail', async ({ page }) => {
  await openNewPage(page);
  await page.route(SAVE_FUNCTION, (route) => route.abort('failed'));

  await typeInEditor(page, 'belum tersimpan');
  await page.waitForTimeout(2000);
  await expect(page.getByText(DRAFT_BANNER)).toBeHidden();

  await page.unroute(SAVE_FUNCTION);
  await reloadSettled(page);
  await expect(page.getByText(DRAFT_BANNER)).toBeVisible();
});

test('signing out right after typing saves the text and leaves no draft', async ({ page }) => {
  const entityId = await openNewPage(page);
  await typeInEditor(page, 'Catatan akhir');
  await signOut(page);

  const drafts = await page.evaluate(() =>
    Object.keys(window.localStorage).filter((key) => key.startsWith('archlin.draft.')),
  );
  expect(drafts).toEqual([]);

  await signIn(page);
  await gotoSettled(page, `/s/kerja/p/${entityId}`);
  await expect(editorOf(page)).toContainText('Catatan akhir');
});
