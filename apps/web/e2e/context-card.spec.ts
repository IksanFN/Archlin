import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { expectNoA11yViolations } from './helpers/a11y';
import { resetAccount } from './helpers/db';
import { completeSetup, gotoSettled, reloadSettled } from './helpers/flows';

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

async function openNewPage(page: Page, noteType: string): Promise<void> {
  await page.getByRole('main').getByRole('button', { name: 'Halaman baru' }).first().click();
  await page.getByRole('menuitem', { name: noteType }).click();
  await expect(page).toHaveURL(/\/s\/kerja\/p\//);
  await expect(page.getByRole('button', { name: 'Kartu Konteks' })).toBeVisible();
}

const chipField = (page: Page, name: string) => page.getByRole('combobox', { name, exact: true });

test('context, aliases, tags and type fields are saved and survive a reload', async ({ page }) => {
  await completeSetup(page);
  await createSpace(page, 'Kerja');
  await openNewPage(page, 'Runbook');

  await page.getByLabel('Ringkasan', { exact: true }).fill('Cara memulihkan layanan tagihan');
  await page.getByLabel('Sistem/Layanan', { exact: true }).fill('Billing');
  await page.getByLabel('Risiko', { exact: true }).selectOption('tinggi');
  await chipField(page, 'Alias').fill('tagihan');
  await chipField(page, 'Alias').press('Enter');
  await chipField(page, 'Tag').fill('ops');
  await chipField(page, 'Tag').press('Enter');

  await expect(page.getByRole('button', { name: 'Hapus alias tagihan' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Hapus tag ops' })).toBeVisible();
  await expect(page.getByText('Tersimpan', { exact: true })).toBeVisible();

  await reloadSettled(page);
  await expect(page.getByLabel('Ringkasan', { exact: true })).toHaveValue('Cara memulihkan layanan tagihan');
  await expect(page.getByLabel('Sistem/Layanan', { exact: true })).toHaveValue('Billing');
  await expect(page.getByLabel('Risiko', { exact: true })).toHaveValue('tinggi');
  await expect(page.getByRole('button', { name: 'Hapus alias tagihan' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Hapus tag ops' })).toBeVisible();
});

test('an existing tag is suggested on another page and the folded card stays folded after a reload', async ({ page }) => {
  await completeSetup(page);
  await createSpace(page, 'Kerja');
  await openNewPage(page, 'Quick Note');
  await chipField(page, 'Tag').fill('infra');
  await chipField(page, 'Tag').press('Enter');
  await expect(page.getByRole('button', { name: 'Hapus tag infra' })).toBeVisible();

  await gotoSettled(page, '/s/kerja');
  await openNewPage(page, 'Quick Note');
  await chipField(page, 'Tag').fill('inf');
  await expect(page.getByRole('option', { name: 'infra' })).toBeVisible();
  await page.getByRole('option', { name: 'infra' }).click();
  await expect(page.getByRole('button', { name: 'Hapus tag infra' })).toBeVisible();

  await page.getByLabel('Ringkasan', { exact: true }).fill('Ringkas');
  await page.getByRole('button', { name: 'Kartu Konteks' }).click();
  await expect(page.getByLabel('Ringkasan', { exact: true })).toBeHidden();
  await expect(page.getByText('Ringkas', { exact: true })).toBeVisible();

  await reloadSettled(page);
  await expect(page.getByRole('button', { name: 'Kartu Konteks' })).toBeVisible();
  await expect(page.getByLabel('Ringkasan', { exact: true })).toBeHidden();
});

test('the context card and its type fields have no axe violations', async ({ page }) => {
  await completeSetup(page);
  await createSpace(page, 'Kerja');
  await openNewPage(page, 'Runbook');
  await chipField(page, 'Alias').fill('tagihan');
  await chipField(page, 'Alias').press('Enter');
  await expectNoA11yViolations(page);
});
