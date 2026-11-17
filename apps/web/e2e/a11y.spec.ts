import { pdfFixture } from '@archlin/testing/files';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { resetAccount } from './helpers/db';
import { expectNoA11yViolations } from './helpers/a11y';
import { ACCOUNT, completeSetup, openAccountMenu, signOut, gotoSettled, reloadSettled } from './helpers/flows';
import { filePayload } from './helpers/files';
import { createPage, createSpace, editorOf, insertWikiLink, menu, typeInEditor, waitSaved } from './helpers/knowledge';

for (const theme of ['light', 'dark'] as const) {
  test(`has no axe violations in ${theme} mode`, async ({ page }) => {
    await resetAccount();
    await page.addInitScript((chosen) => window.localStorage.setItem('archlin.theme', chosen), theme);

    const check = async (path: string): Promise<void> => {
      await gotoSettled(page, path);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expectNoA11yViolations(page);
    };

    await check('/setup');
    await completeSetup(page);
    await check('/');
    await check('/settings/security');
    await signOut(page);
    await check('/login');
    await check('/login/totp');
  });
}

async function startAtLogin(page: Page): Promise<void> {
  await resetAccount();
  await completeSetup(page);
  await signOut(page);
}

test('completes login with the keyboard only', async ({ page }) => {
  await startAtLogin(page);
  await gotoSettled(page, '/login');
  // The email field takes focus on load, so the skip link is the stop right before it.
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('link', { name: 'Lewati ke konten' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Email')).toBeFocused();
  await page.keyboard.type(ACCOUNT.email);
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Password', { exact: true })).toBeFocused();
  await page.keyboard.type(ACCOUNT.password);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL('/');
});

test('returns focus after closing a dialog with Escape', async ({ page }) => {
  await resetAccount();
  await completeSetup(page);
  await gotoSettled(page, '/settings/security');
  const trigger = page.getByRole('button', { name: 'Ganti password' });
  await trigger.click();
  await expect(page.getByRole('dialog', { name: 'Ganti password' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('theme choice persists across reloads', async ({ page }) => {
  await resetAccount();
  await completeSetup(page);
  await openAccountMenu(page);
  await page.getByRole('menuitemradio', { name: 'Terang' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await reloadSettled(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('the page screen has exactly one h1 that names the page', async ({ page }) => {
  await resetAccount();
  await completeSetup(page);
  await page.getByRole('button', { name: 'Buat space' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Buat space' });
  await dialog.getByLabel('Nama').fill('Kerja');
  await dialog.getByRole('button', { name: 'Buat space' }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('main').getByRole('button', { name: 'Halaman baru' }).first().click();
  await page.getByRole('menuitem', { name: 'Quick Note' }).click();
  await expect(page).toHaveURL(/\/s\/kerja\/p\//);

  const headings = page.getByRole('heading', { level: 1 });
  await expect(headings).toHaveCount(1);
  await expect(headings).toHaveText('Tanpa judul');
  await page.getByRole('textbox', { name: 'Judul' }).fill('Rencana rilis');
  await expect(headings).toHaveText('Rencana rilis');
  await expectNoA11yViolations(page);
});

async function applyTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate((chosen) => window.localStorage.setItem('archlin.theme', chosen), theme);
  await reloadSettled(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

test('M1 screens pass axe in light and dark', async ({ page, context }) => {
  test.setTimeout(240_000);
  await resetAccount();
  await completeSetup(page);
  const { slug } = await createSpace(page, 'Kerja');
  const main = await createPage(page, { space: slug, type: 'Runbook', title: 'Prosedur' });
  await createPage(page, { space: slug, type: 'Quick Note', title: 'Sampah' });
  await page.getByRole('button', { name: 'Opsi halaman' }).click();
  await page.getByRole('menuitem', { name: 'Pindahkan ke Trash' }).click();
  await expect(page.getByText('Halaman ini ada di Trash. Isinya hanya bisa dibaca.')).toBeVisible();
  await gotoSettled(page, main.url);

  for (const theme of ['light', 'dark'] as const) {
    await applyTheme(page, theme);

    await gotoSettled(page, `/s/${slug}`);
    await expect(page.getByRole('region', { name: 'Halaman akar' })).toBeVisible();
    await expectNoA11yViolations(page);

    await gotoSettled(page, main.url);
    await expect(page.getByRole('button', { name: 'Kartu Konteks' })).toHaveAttribute('aria-expanded', 'true');
    await expect(editorOf(page)).toBeVisible();
    await expectNoA11yViolations(page);

    await page.getByRole('button', { name: 'Opsi halaman' }).click();
    await page.getByRole('menuitem', { name: 'Pindahkan ke…' }).click();
    const moveDialog = page.getByRole('dialog', { name: /Pindahkan/ });
    await expect(moveDialog.getByRole('treeitem', { name: 'Akar space' })).toBeVisible();
    await expectNoA11yViolations(page);
    await page.keyboard.press('Escape');
    await expect(moveDialog).toBeHidden();

    // The first tab saves a change the second tab has not seen, so the second tab's edit conflicts.
    // The second tab opens only now: with a second live page Firefox crashes while axe walks the first one.
    const second = await context.newPage();
    await gotoSettled(second, main.url);
    await expect(editorOf(second)).toBeVisible();
    await editorOf(page).click();
    await page.keyboard.type(` ${theme}`);
    await waitSaved(page);
    await editorOf(second).click();
    await second.keyboard.type(' lokal');
    const conflict = second.getByRole('dialog', { name: 'Halaman ini berubah di tab atau perangkat lain' });
    await expect(conflict).toBeVisible();
    await expectNoA11yViolations(second);
    await conflict.getByRole('button', { name: 'Muat versi terbaru' }).click();
    await expect(conflict).toBeHidden();
    await second.close();

    await gotoSettled(page, '/settings/trash');
    await expect(page.getByText('Sampah').first()).toBeVisible();
    await expectNoA11yViolations(page);

    await gotoSettled(page, '/settings/note-types');
    await expect(page.getByRole('link', { name: 'Runbook' })).toBeVisible();
    await expectNoA11yViolations(page);
    await page.getByRole('link', { name: 'Runbook' }).click();
    await expect(page.getByLabel('Nama tipe', { exact: true })).toBeVisible();
    await expectNoA11yViolations(page);
  }
});

test('the save status is announced politely', async ({ page }) => {
  await resetAccount();
  await completeSetup(page);
  const { slug } = await createSpace(page, 'Kerja');
  await createPage(page, { space: slug, type: 'Quick Note', title: 'Status simpan' });

  const status = page.locator('[data-slot="save-status"] [role="status"]');
  await expect(status).toHaveAttribute('aria-live', 'polite');
  // A routine save is visible but never announced.
  await expect(status).toHaveText('');

  await page.route('**/_serverFn/kb-save-page', (route) => route.abort('failed'));
  await editorOf(page).click();
  await page.keyboard.type('gagal disimpan');
  await expect(status).toHaveText('Gagal menyimpan. Mencoba lagi…');
});

test('M2 surfaces pass axe in light and dark', async ({ page }) => {
  test.setTimeout(300_000);
  await resetAccount();
  await completeSetup(page);
  const { slug } = await createSpace(page, 'Kerja');
  await createPage(page, { space: slug, type: 'Quick Note', title: 'Rollback Postgres' });
  const source = await createPage(page, { space: slug, type: 'Quick Note', title: 'Sumber' });
  // Each link sits in a sentence of its own: two links side by side are not the shape of a page worth judging by target size.
  await typeInEditor(page, 'Prosedur pemulihan ada di ');
  await insertWikiLink(page, 'Rollback', 'Rollback Postgres');
  await typeInEditor(page, ' untuk dibaca sebelum rilis.');
  await page.keyboard.press('Enter');
  await typeInEditor(page, 'Bagian berikutnya masih disusun di ');
  await insertWikiLink(page, 'Belum ada', 'create');
  await typeInEditor(page, ' dan belum bisa dibuka.');
  await menu(page, 'Lampiran');
  await page
    .getByRole('complementary', { name: 'Lampiran' })
    .or(page.getByRole('dialog', { name: 'Lampiran' }))
    .locator('input[type="file"]')
    .setInputFiles(filePayload('laporan.pdf', 'application/pdf', pdfFixture('Halo')));
  await expect(editorOf(page).locator('[data-attachment]', { hasText: 'laporan.pdf' })).toBeVisible();
  await page.keyboard.press('Escape');
  await waitSaved(page);
  await menu(page, 'Simpan versi');
  await page.getByLabel('Nama versi (opsional)').fill('Titik awal');
  await page.getByRole('button', { name: 'Simpan', exact: true }).click();
  await expect(page.getByText('Versi disimpan.')).toBeVisible();
  await typeInEditor(page, ' tambahan');
  await waitSaved(page);

  for (const theme of ['light', 'dark'] as const) {
    await applyTheme(page, theme);
    await gotoSettled(page, source.url);
    await expect(editorOf(page)).toBeVisible();

    await editorOf(page).click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type(' [[Roll');
    await expect(page.getByRole('option', { name: /^Rollback Postgres/ })).toBeVisible();
    await expectNoA11yViolations(page);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Backspace', { delay: 0 });
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');

    await editorOf(page).getByRole('button', { name: 'Belum ada' }).click();
    await expect(page.getByText('Halaman “Belum ada” belum ada.')).toBeVisible();
    await expectNoA11yViolations(page);
    await page.keyboard.press('Escape');
    // The popover leaves with an exit transition and only then hands focus back to the editor, which scrolls the caret into
    // view; opening the page menu before that would have the page jump under it.
    await expect(page.getByText('Halaman “Belum ada” belum ada.')).toBeHidden();
    await expect(editorOf(page)).toBeFocused();

    await menu(page, 'Riwayat versi');
    await page.getByRole('button', { name: /Titik awal/ }).click();
    await expect(page.getByText('Ditambah: ').first()).toBeVisible();
    await expectNoA11yViolations(page);
    await page.keyboard.press('Escape');

    await menu(page, 'Lampiran');
    await expect(page.getByRole('complementary', { name: 'Lampiran' })).toContainText('laporan.pdf');
    await expectNoA11yViolations(page);
    await page.keyboard.press('Escape');
  }
});
