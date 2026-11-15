import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { resetAccount } from './helpers/db';
import { completeSetup, reloadSettled } from './helpers/flows';
import { createPage, createSpace, editorOf, saveProblem, waitSaved } from './helpers/knowledge';

test.beforeEach(async () => {
  await resetAccount();
});

async function openNewPage(page: Page, type: string): Promise<void> {
  await completeSetup(page);
  const { slug } = await createSpace(page, 'Kerja');
  await createPage(page, { space: slug, type, title: 'Contoh' });
  await expect(page.getByRole('button', { name: 'Kartu Konteks' })).toBeVisible();
}

test('a runbook page starts from its template', async ({ page }) => {
  await openNewPage(page, 'Runbook');

  for (const heading of ['Tujuan', 'Prasyarat', 'Langkah', 'Verifikasi', 'Rollback']) {
    await expect(editorOf(page).getByRole('heading', { name: heading, exact: true })).toBeVisible();
  }
  for (const label of ['Sistem/Layanan', 'Prasyarat', 'Risiko', 'Rollback']) {
    await expect(page.getByLabel(label, { exact: true })).toBeVisible();
  }
});

test('a field value outside its rules is rejected and shown on the field', async ({ page }) => {
  await openNewPage(page, 'Referensi');

  const url = page.getByLabel('URL', { exact: true });
  await url.fill('ftp://x.id');
  await expect(saveProblem(page, 'Ada field yang belum valid')).toBeVisible();
  await expect(url).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Nilai ini tidak valid.').or(page.getByText('Nilai ini tidak cocok dengan jenis field.'))).toBeVisible();

  await url.fill('https://contoh.id/panduan');
  await waitSaved(page);
  await expect(url).not.toHaveAttribute('aria-invalid', 'true');
  await expect(saveProblem(page, 'Ada field yang belum valid')).toBeHidden();

  await reloadSettled(page);
  await expect(page.getByLabel('URL', { exact: true })).toHaveValue('https://contoh.id/panduan');
});

test('risk offers only rendah, sedang and tinggi', async ({ page }) => {
  await openNewPage(page, 'Runbook');

  const values = await page.getByLabel('Risiko', { exact: true }).evaluate((select) =>
    Array.from((select as HTMLSelectElement).options, (option) => option.value),
  );
  expect(values).toEqual(['', 'rendah', 'sedang', 'tinggi']);
});
