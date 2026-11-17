import { PNG_BYTES, pdfFixture } from '@archlin/testing/files';
import { closeSync, ftruncateSync, openSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { attachmentIdsOf, resetAccount, setAttachmentExtraction } from './helpers/db';
import { filePayload } from './helpers/files';
import { completeSetup, gotoSettled } from './helpers/flows';
import { createPage, createSpace, editorOf, menu, typeInEditor, waitSaved } from './helpers/knowledge';

test.beforeEach(async () => {
  await resetAccount();
});

// The picker input is hidden and unlabelled (a button opens it), so it is found inside the panel that owns it. The panel is a
// docked column on a wide window and a sheet on a narrow one.
const attachmentsInput = (page: Page): Locator =>
  page
    .getByRole('complementary', { name: 'Lampiran' })
    .or(page.getByRole('dialog', { name: 'Lampiran' }))
    .locator('input[type="file"]');

test('an uploaded pdf shows as a card, opens in a new tab and reports its extraction status', async ({ page }) => {
  await completeSetup(page);
  const { slug } = await createSpace(page, 'Kerja');
  const p = await createPage(page, { space: slug, type: 'Quick Note', title: 'Laporan' });
  await menu(page, 'Lampiran');
  await attachmentsInput(page).setInputFiles(filePayload('laporan.pdf', 'application/pdf', pdfFixture('Halo')));
  const card = editorOf(page).locator('[data-attachment]', { hasText: 'laporan.pdf' });
  await expect(card).toContainText('Menunggu ekstraksi teks');
  const open = card.getByRole('link', { name: 'Buka' });
  await expect(open).toHaveAttribute('target', '_blank');
  const href = await open.getAttribute('href');
  expect(href).toMatch(/^\/files\/[0-9a-f-]{36}$/);
  if (href === null) throw new Error('the open link has no address');
  const res = await page.request.get(href);
  expect([res.status(), res.headers()['content-type'], res.headers()['content-disposition']?.split(';')[0]]).toEqual([
    200,
    'application/pdf',
    'inline',
  ]);
  const [id] = await attachmentIdsOf(p.entityId);
  if (id === undefined) throw new Error('the upload did not create an attachment');
  await setAttachmentExtraction(id, 'no_text');
  await page.keyboard.press('Escape');
  await menu(page, 'Lampiran');
  await expect(page.getByRole('complementary', { name: 'Lampiran' }).or(page.getByRole('dialog', { name: 'Lampiran' }))).toContainText(
    'Teks tidak ditemukan. Kemungkinan hasil scan.',
  );
});

// The editor styles its paragraphs, which must not reach into a card: the name keeps the small text size and the details line the mono 12px.
test('an attachment card keeps its own type sizes inside the editor', async ({ page }) => {
  await completeSetup(page);
  const { slug } = await createSpace(page, 'Kerja');
  await createPage(page, { space: slug, type: 'Quick Note', title: 'Ukuran' });
  await menu(page, 'Lampiran');
  await attachmentsInput(page).setInputFiles(filePayload('laporan.pdf', 'application/pdf', pdfFixture('Halo')));
  const card = editorOf(page).locator('[data-attachment]', { hasText: 'laporan.pdf' });
  const size = (slot: string): Promise<string> => card.locator(`[data-slot="${slot}"]`).evaluate((el) => getComputedStyle(el).fontSize);
  expect([await size('attachment-name'), await size('attachment-meta')]).toEqual(['14px', '12px']);
});

test('an image uploaded from the image dialog renders from its attachment', async ({ page }) => {
  await completeSetup(page);
  const { slug } = await createSpace(page, 'Kerja');
  await createPage(page, { space: slug, type: 'Quick Note', title: 'Grafik' });
  await typeInEditor(page, '/Gambar');
  await page.keyboard.press('Enter');
  await page.getByRole('dialog').locator('input[type="file"]').setInputFiles(filePayload('grafik.png', 'image/png', PNG_BYTES));
  const img = editorOf(page).locator('img[src^="/files/"]');
  await expect(img).toBeVisible();
  expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1);
});

test('a file over 50 MB is refused before uploading', async ({ page }, testInfo) => {
  await completeSetup(page);
  const { slug } = await createSpace(page, 'Kerja');
  await createPage(page, { space: slug, type: 'Quick Note', title: 'Besar' });
  const uploads: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && new URL(r.url()).pathname === '/files') uploads.push(r.url());
  });
  await menu(page, 'Lampiran');
  // Playwright refuses an in-memory buffer over 50 MB, so the file is a sparse one on disk, one byte over the limit.
  const big = testInfo.outputPath('besar.bin');
  const handle = openSync(big, 'w');
  ftruncateSync(handle, 52_428_801);
  closeSync(handle);
  await attachmentsInput(page).setInputFiles(big);
  await expect(page.getByText('besar.bin lebih dari 50 MB dan tidak diunggah.')).toBeVisible();
  expect(uploads).toEqual([]);
});

test('an unused attachment can be moved to trash and shows there', async ({ page }) => {
  await completeSetup(page);
  const { slug } = await createSpace(page, 'Kerja');
  await createPage(page, { space: slug, type: 'Quick Note', title: 'Arsip' });
  await menu(page, 'Lampiran');
  await attachmentsInput(page).setInputFiles(filePayload('laporan.pdf', 'application/pdf', pdfFixture('Halo')));
  await page.keyboard.press('Escape');
  await editorOf(page).locator('[data-attachment]').click();
  await page.keyboard.press('Delete');
  await waitSaved(page);
  await menu(page, 'Lampiran');
  await page.getByRole('button', { name: 'Pindahkan ke Trash' }).click();
  await expect(page.getByText('1 lampiran dipindahkan ke Trash. Bisa dipulihkan dari Pengaturan, Trash.')).toBeVisible();
  await gotoSettled(page, '/settings/trash');
  await expect(page.getByText('laporan.pdf')).toBeVisible();
  await expect(page.getByText('Lampiran dari Arsip')).toBeVisible();
});
