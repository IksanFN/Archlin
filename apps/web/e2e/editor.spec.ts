import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { resetAccount } from './helpers/db';
import { completeSetup, reloadSettled } from './helpers/flows';
import { createPage, createSpace, editorOf, saveProblem, savedLabel, waitSaved } from './helpers/knowledge';

// One transparent pixel; the image dialog measures the picture before inserting it.
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

test.beforeEach(async () => {
  await resetAccount();
});

async function openEditor(page: Page): Promise<void> {
  await completeSetup(page);
  const { slug } = await createSpace(page, 'Kerja');
  await createPage(page, { space: slug, type: 'Quick Note', title: 'Uji editor' });
  await editorOf(page).click();
}

async function slash(page: Page, query: string, option: string): Promise<void> {
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(`/${query}`);
  const item = page.getByRole('option', { name: option, exact: true });
  await expect(item).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(item).toBeHidden();
}

// A synthetic paste with its own DataTransfer is the only way to paste without the OS clipboard.
async function pastePlainText(page: Page, text: string): Promise<void> {
  await editorOf(page).click();
  await page.evaluate((value) => {
    const data = new DataTransfer();
    data.setData('text/plain', value);
    document.querySelector('.ProseMirror')?.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
}

test('markdown shortcuts and the slash menu insert every block', async ({ page }) => {
  await page.route('https://contoh.test/gambar.png', (route) => route.fulfill({ contentType: 'image/png', body: PIXEL_PNG }));
  await openEditor(page);
  const editor = editorOf(page);

  await page.keyboard.type('# Judul satu');
  await page.keyboard.press('Enter');
  await page.keyboard.type('## Judul dua');
  await page.keyboard.press('Enter');
  await page.keyboard.type('### Judul tiga');
  await page.keyboard.press('Enter');
  await page.keyboard.type('- butir daftar');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('1. butir nomor');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('[ ] tugas');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('> kutipan');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('``` echo halo');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('---');

  await expect(editor.locator('h2', { hasText: 'Judul satu' })).toBeVisible();
  await expect(editor.locator('h3', { hasText: 'Judul dua' })).toBeVisible();
  await expect(editor.locator('h4', { hasText: 'Judul tiga' })).toBeVisible();
  await expect(editor.locator('ul:not([data-type="taskList"]) li', { hasText: 'butir daftar' })).toBeVisible();
  await expect(editor.locator('ol li', { hasText: 'butir nomor' })).toBeVisible();
  await expect(editor.locator('ul[data-type="taskList"] li', { hasText: 'tugas' })).toBeVisible();
  await expect(editor.locator('blockquote', { hasText: 'kutipan' })).toBeVisible();
  await expect(editor.locator('pre', { hasText: 'echo halo' })).toBeVisible();
  await expect(editor.locator('hr')).toHaveCount(1);

  for (const [query, option, variant] of [
    ['info', 'Callout info', 'info'],
    ['peringatan', 'Callout peringatan', 'warning'],
    ['bahaya', 'Callout bahaya', 'danger'],
    ['sukses', 'Callout sukses', 'success'],
  ] as const) {
    await slash(page, query, option);
    await expect(editor.locator(`[data-callout][data-variant="${variant}"]`)).toHaveCount(1);
  }

  await slash(page, 'toggle', 'Toggle');
  await expect(editor.locator('[data-type="details"]')).toHaveCount(1);

  await slash(page, 'tabel', 'Tabel');
  await expect(editor.locator('table')).toHaveCount(1);
  await expect(editor.locator('table tr')).toHaveCount(3);

  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('/gambar');
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Gambar dari URL' });
  await dialog.getByLabel('Alamat gambar').fill('https://contoh.test/gambar.png');
  await dialog.getByLabel('Deskripsi gambar').fill('Piksel uji');
  await dialog.getByRole('button', { name: 'Sisipkan' }).click();
  await expect(dialog).toBeHidden();
  await expect(editor.locator('img[src="https://contoh.test/gambar.png"]')).toHaveCount(1);

  await waitSaved(page);
  await reloadSettled(page);
  await expect(editor.locator('[data-callout]')).toHaveCount(4);
  await expect(editor.locator('[data-type="details"]')).toHaveCount(1);
  await expect(editor.locator('table')).toHaveCount(1);
  await expect(editor.locator('img[src="https://contoh.test/gambar.png"]')).toHaveCount(1);
});

test('pasted markdown becomes headings and lists', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'A synthetic paste event delivers no clipboard data to the editor in Firefox');
  await openEditor(page);
  await pastePlainText(page, '# Rencana\n\n- satu\n- dua\n\n1. pertama\n2. kedua');

  const editor = editorOf(page);
  await expect(editor.locator('h2', { hasText: 'Rencana' })).toBeVisible();
  await expect(editor.locator('ul li')).toHaveCount(2);
  await expect(editor.locator('ol li')).toHaveCount(2);
  await expect(editor).not.toContainText('# Rencana');
});

test('find and replace changes every match', async ({ page }) => {
  await openEditor(page);
  await page.keyboard.type('kucing makan ikan lalu kucing tidur');

  await page.keyboard.press('ControlOrMeta+f');
  const find = page.getByLabel('Cari', { exact: true });
  await expect(find).toBeFocused();
  await find.fill('kucing');
  await expect(page.getByText('1 dari 2')).toBeVisible();
  await page.getByLabel('Ganti dengan').fill('anjing');
  await page.getByRole('button', { name: 'Ganti semua' }).click();

  await expect(editorOf(page)).toContainText('anjing makan ikan lalu anjing tidur');
  await expect(editorOf(page)).not.toContainText('kucing');
  await waitSaved(page);
  await reloadSettled(page);
  await expect(editorOf(page)).toContainText('anjing makan ikan lalu anjing tidur');
});

test('copy in a code block shows Disalin and returns', async ({ page, context, browserName }) => {
  if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openEditor(page);
  await page.keyboard.type('``` systemctl restart billing');

  const copy = page.getByRole('button', { name: 'Salin', exact: true });
  await copy.click();
  await expect(page.getByRole('button', { name: 'Disalin', exact: true })).toBeVisible();
  if (browserName === 'chromium') {
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('systemctl restart billing');
  }
  await expect(page.getByRole('button', { name: 'Salin', exact: true })).toBeVisible();
});

test('offline edits are saved after reconnect', async ({ page, context }) => {
  await openEditor(page);
  await context.setOffline(true);
  await page.keyboard.type('ditulis tanpa jaringan');
  await expect(saveProblem(page, 'Offline. Perubahan disimpan di perangkat ini.')).toBeVisible({ timeout: 15_000 });

  await context.setOffline(false);
  await expect(savedLabel(page)).toBeVisible({ timeout: 30_000 });
  await reloadSettled(page);
  await expect(editorOf(page)).toContainText('ditulis tanpa jaringan');
});

test('a javascript link is refused', async ({ page }) => {
  await openEditor(page);
  await page.keyboard.type('situs resmi');
  await page.keyboard.press('Shift+Home');

  await page.getByRole('button', { name: 'Tautan' }).click();
  const url = page.getByLabel('Alamat tautan');
  await url.fill('javascript:alert(1)');
  await page.getByRole('button', { name: 'Simpan', exact: true }).click();

  await expect(page.getByText('Pakai alamat http, https, atau mailto.')).toBeVisible();
  await expect(editorOf(page).locator('a')).toHaveCount(0);

  await url.fill('https://contoh.id');
  await page.getByRole('button', { name: 'Simpan', exact: true }).click();
  await expect(editorOf(page).locator('a[href="https://contoh.id"]')).toHaveCount(1);
});
