import { expect, test } from '@playwright/test';
import { pageVersion, resetAccount, versionReasons } from './helpers/db';
import { completeSetup } from './helpers/flows';
import { createPage, createSpace, editorOf, menu, typeInEditor, waitSaved } from './helpers/knowledge';
import { advanceClock } from './helpers/totp';

test.beforeEach(async () => {
  await resetAccount();
});

test('restoring a version writes a new version after saving the current one', async ({ page }) => {
  await completeSetup(page);
  const { slug } = await createSpace(page, 'Kerja');
  const p = await createPage(page, { space: slug, type: 'Quick Note', title: 'Runbook' });
  await typeInEditor(page, 'versi lama');
  await waitSaved(page);
  await menu(page, 'Simpan versi');
  await page.getByLabel('Nama versi (opsional)').fill('Sebelum revisi');
  await page.getByRole('button', { name: 'Simpan', exact: true }).click();
  await expect(page.getByText('Versi disimpan.')).toBeVisible();
  await editorOf(page).fill('versi baru');
  await waitSaved(page);
  await menu(page, 'Riwayat versi');
  await page.getByRole('button', { name: /Sebelum revisi/ }).click();
  // The diff reads from the picked version to now: what the saved version had and the page no longer has is "removed".
  await expect(page.getByText('Dihapus: versi lama')).toBeVisible();
  await expect(page.getByText('Ditambah: versi baru')).toBeVisible();
  await page.getByRole('radio', { name: 'Pratinjau' }).click();
  await expect(page.getByText('versi lama').first()).toBeVisible();
  const before = await pageVersion(p.entityId);
  await page.getByRole('button', { name: 'Pulihkan versi ini' }).click();
  await expect(page.getByText('Versi dipulihkan.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(editorOf(page)).toHaveText('versi lama');
  expect(await pageVersion(p.entityId)).toBe(before + 1);
  expect(await versionReasons(p.entityId)).toEqual(['pre_restore', 'manual']);
});

test('editing again after ten idle minutes snapshots the earlier state', async ({ page, request }) => {
  await completeSetup(page);
  const { slug } = await createSpace(page, 'Kerja');
  const p = await createPage(page, { space: slug, type: 'Quick Note', title: 'Runbook' });
  await typeInEditor(page, 'pertama');
  await waitSaved(page);
  await advanceClock(request, 11 * 60_000);
  await typeInEditor(page, ' kedua');
  await waitSaved(page);
  expect((await versionReasons(p.entityId))[0]).toBe('idle');
});
