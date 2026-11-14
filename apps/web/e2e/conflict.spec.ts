import { expect, test } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { conflictCopies, pageVersion, resetAccount } from './helpers/db';
import { completeSetup, gotoSettled, reloadSettled } from './helpers/flows';
import { createPage, createSpace, editorOf, savedLabel, waitSaved } from './helpers/knowledge';

const SAVE_FUNCTION = '**/_serverFn/kb-save-page';
const CONFLICT_TITLE = 'Halaman ini berubah di tab atau perangkat lain';
const DRAFT_BANNER = /Ada perubahan yang belum tersimpan dari/;
const TRASH_BANNER = 'Halaman ini ada di Trash. Isinya hanya bisa dibaca.';

test.beforeEach(async () => {
  await resetAccount();
});

async function typeInEditor(page: Page, text: string): Promise<void> {
  await editorOf(page).click();
  await page.keyboard.type(text);
}

async function openPage(page: Page): Promise<{ entityId: string; url: string }> {
  await completeSetup(page);
  const { slug } = await createSpace(page, 'Kerja');
  return createPage(page, { space: slug, type: 'Quick Note', title: 'Catatan bersama' });
}

// A second tab on the same page, loaded at the version the first tab has saved so far.
async function openSecondTab(context: BrowserContext, url: string): Promise<Page> {
  const second = await context.newPage();
  await gotoSettled(second, url);
  await expect(editorOf(second)).toBeVisible();
  return second;
}

// Tab one saves "isi tab pertama" while tab two, still on the older version, ends up in the conflict dialog.
async function conflictInSecondTab(page: Page, context: BrowserContext, url: string): Promise<Page> {
  const second = await openSecondTab(context, url);
  await typeInEditor(page, 'isi tab pertama');
  await waitSaved(page);
  await typeInEditor(second, 'isi tab kedua');
  await expect(second.getByRole('dialog', { name: CONFLICT_TITLE })).toBeVisible();
  return second;
}

test('two tabs: overwrite keeps the other copy', async ({ page, context }) => {
  const { entityId, url } = await openPage(page);
  const second = await conflictInSecondTab(page, context, url);

  await second.getByRole('button', { name: 'Timpa' }).click();
  await expect(second.getByRole('dialog', { name: CONFLICT_TITLE })).toBeHidden();
  await expect(savedLabel(second)).toBeVisible();

  const copies = await conflictCopies(entityId);
  expect(copies).toHaveLength(1);
  expect(copies[0]?.contentText).toContain('isi tab pertama');

  await reloadSettled(page);
  await expect(editorOf(page)).toContainText('isi tab kedua');
});

test('two tabs: load latest keeps the local copy', async ({ page, context }) => {
  const { entityId, url } = await openPage(page);
  const second = await conflictInSecondTab(page, context, url);

  await second.getByRole('button', { name: 'Muat versi terbaru' }).click();
  await expect(second.getByRole('dialog', { name: CONFLICT_TITLE })).toBeHidden();
  await expect(editorOf(second)).toContainText('isi tab pertama');
  await expect(editorOf(second)).not.toContainText('isi tab kedua');

  const copies = await conflictCopies(entityId);
  expect(copies).toHaveLength(1);
  expect(copies[0]?.contentText).toContain('isi tab kedua');
});

test('a third change during the dialog asks again', async ({ page, context }) => {
  const { entityId, url } = await openPage(page);
  const second = await conflictInSecondTab(page, context, url);

  // The first tab changes the page again while the dialog is still open.
  await typeInEditor(page, ' dan perubahan ketiga');
  await waitSaved(page);
  const versionBefore = await pageVersion(entityId);

  await second.getByRole('button', { name: 'Timpa' }).click();
  await expect(second.getByText('Halaman berubah lagi. Pilih sekali lagi.')).toBeVisible();
  await expect(second.getByRole('dialog', { name: CONFLICT_TITLE })).toBeVisible();
  expect(await pageVersion(entityId)).toBe(versionBefore);

  await reloadSettled(page);
  await expect(editorOf(page)).toContainText('isi tab pertama dan perubahan ketiga');

  await second.getByRole('button', { name: 'Timpa' }).click();
  await expect(second.getByRole('dialog', { name: CONFLICT_TITLE })).toBeHidden();
  expect(await pageVersion(entityId)).toBeGreaterThan(versionBefore);
});

test('editing a page that another tab moved to trash keeps the text', async ({ page, context }) => {
  const { url } = await openPage(page);
  const second = await openSecondTab(context, url);
  await second.getByRole('button', { name: 'Opsi halaman' }).click();
  await second.getByRole('menuitem', { name: 'Pindahkan ke Trash' }).click();
  await expect(second.getByText(TRASH_BANNER)).toBeVisible();

  await typeInEditor(page, 'tulisan yang harus selamat');
  await expect(page.getByText(TRASH_BANNER)).toBeVisible();
  await expect(editorOf(page)).toContainText('tulisan yang harus selamat');
  const drafts = await page.evaluate(() => Object.keys(window.localStorage).filter((key) => key.startsWith('archlin.draft.')));
  expect(drafts.length).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Pulihkan' }).click();
  await expect(page.getByText(TRASH_BANNER)).toBeHidden();
  await expect(editorOf(page)).toContainText('tulisan yang harus selamat');
  await waitSaved(page);

  await reloadSettled(page);
  await expect(editorOf(page)).toContainText('tulisan yang harus selamat');
});

test('retry after a lost response does not open the conflict dialog', async ({ page }) => {
  const { entityId } = await openPage(page);
  const versionBefore = await pageVersion(entityId);
  // The first save reaches the server and commits, but the browser never sees the answer.
  await page.route(
    SAVE_FUNCTION,
    async (route) => {
      await route.fetch();
      await route.abort('failed');
    },
    { times: 1 },
  );

  await typeInEditor(page, 'isi yang jawabannya hilang');
  await expect(savedLabel(page)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('dialog', { name: CONFLICT_TITLE })).toBeHidden();
  expect(await pageVersion(entityId)).toBe(versionBefore + 1);

  await reloadSettled(page);
  await expect(editorOf(page)).toContainText('isi yang jawabannya hilang');
});

test('a draft survives a closed tab and can be restored', async ({ page, context }) => {
  const { url } = await openPage(page);
  // The save never leaves the browser, so the only copy of the text is the local draft.
  await page.route(SAVE_FUNCTION, () => undefined);
  await typeInEditor(page, 'catatan yang belum sempat tersimpan');
  await expect
    .poll(() => page.evaluate(() => Object.keys(window.localStorage).some((key) => key.startsWith('archlin.draft.'))))
    .toBe(true);
  await page.close();

  const reopened = await context.newPage();
  await gotoSettled(reopened, url);
  await expect(reopened.getByText(DRAFT_BANNER)).toBeVisible();
  await expect(editorOf(reopened)).not.toContainText('catatan yang belum sempat tersimpan');

  await reopened.getByRole('button', { name: 'Pulihkan' }).click();
  await expect(editorOf(reopened)).toContainText('catatan yang belum sempat tersimpan');
  await expect(savedLabel(reopened)).toBeVisible();
  await expect(reopened.getByText(DRAFT_BANNER)).toBeHidden();

  await reloadSettled(reopened);
  await expect(editorOf(reopened)).toContainText('catatan yang belum sempat tersimpan');
});
