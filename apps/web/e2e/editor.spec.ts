import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { resetAccount } from './helpers/db';
import { completeSetup, reloadSettled } from './helpers/flows';
import { createPage, createSpace, editorOf, pasteHtml, saveProblem, savedLabel, waitSaved } from './helpers/knowledge';

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

test('title shows an unclipped keyboard focus indicator', async ({ page }, testInfo) => {
  await openEditor(page);
  const title = page.getByRole('textbox', { name: 'Judul' });
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => document.documentElement.setAttribute('data-theme', value), theme);
    await editorOf(page).click();
    for (let index = 0; index < 80 && !(await title.evaluate((node) => node === document.activeElement)); index += 1) {
      await page.keyboard.press('Shift+Tab');
    }
    await expect(title).toBeFocused();
    expect(await title.evaluate((node) => node.matches(':focus-visible'))).toBe(true);
    await expect(title).toHaveCSS('outline-style', 'solid');
    await expect(title).toHaveCSS('outline-width', '2px');
    const box = await title.boundingBox();
    if (box === null) throw new Error('the title must be visible');
    expect(box.x).toBeGreaterThanOrEqual(4);
    expect(box.y).toBeGreaterThanOrEqual(4);
    await testInfo.attach(`title-focus-${theme}`, { body: await page.screenshot(), contentType: 'image/png' });
    await page.keyboard.press('Enter');
    await expect(editorOf(page)).toBeFocused();
  }
});

test('bullet and ordered markers remain visible after reload', async ({ page }) => {
  await openEditor(page);
  await page.keyboard.type('- butir shortcut');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('1. nomor shortcut');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await pasteHtml(page, '<ul><li><p>Induk</p><ul><li><p>Anak</p><ul><li><p>Cucu</p></li></ul></li></ul></li></ul><ol start="7"><li><p>Nomor tujuh</p></li></ol><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Tugas</p><ul><li><p>Butir dalam tugas</p></li></ul><ol start="3"><li><p>Nomor dalam tugas</p></li></ol></li></ul>');
  const editor = editorOf(page);
  const check = async (): Promise<void> => {
    await expect(editor.locator('ul:not([data-type="taskList"]) > li > p', { hasText: 'butir shortcut' })).toHaveCount(1);
    await expect(editor.locator('ol > li > p', { hasText: 'nomor shortcut' })).toHaveCount(1);
    for (const list of await editor.locator('ul:not([data-type="taskList"]), ol').all()) {
      await expect(list).not.toHaveCSS('list-style-type', 'none');
      await expect(list.locator(':scope > li').first()).toHaveCSS('display', 'list-item');
    }
    await expect(editor.locator('ul ul').first()).toHaveCSS('list-style-type', 'circle');
    await expect(editor.locator('ul ul ul')).toHaveCSS('list-style-type', 'square');
    await expect(editor.locator('ol[start="7"]')).toHaveCount(1);
    await expect(editor.locator('ol[start="3"]')).toHaveCount(1);
    await expect(editor.locator('ul[data-type="taskList"]')).toHaveCSS('list-style-type', 'none');
    await expect(editor.locator('ul[data-type="taskList"] > li')).toHaveCSS('display', 'flex');
    await expect(editor.getByRole('checkbox')).toHaveCount(1);
  };
  await check();
  await waitSaved(page);
  await reloadSettled(page);
  await check();
});

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

test('a pointer moving from the text reaches the block handle', async ({ page }) => {
  await openEditor(page);
  await page.keyboard.type('Paragraf yang dipindah dengan handle');
  const text = await editorOf(page).locator('p').first().boundingBox();
  const title = await page.getByRole('textbox', { name: 'Judul' }).boundingBox();
  if (text === null || title === null) throw new Error('the paragraph and the title must be on screen');
  // The handle sits in a gutter beside the text, so the text itself stays in line with the title.
  expect(Math.abs(text.x - title.x)).toBeLessThanOrEqual(1);

  await page.mouse.move(text.x + 40, text.y + text.height / 2, { steps: 4 });
  const handle = page.getByRole('button', { name: 'Opsi blok' });
  await expect(handle).toBeVisible();
  const box = await handle.boundingBox();
  if (box === null) throw new Error('the block handle must be on screen');
  expect(box.x + box.width).toBeLessThanOrEqual(text.x);
  // Stepping like a real pointer crosses every pixel between the text and the handle; a jump would skip the gap.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 25 });
  await page.mouse.down();
  await page.mouse.up();
  await expect(page.getByRole('menuitem', { name: /Pindah ke bawah/ })).toBeVisible();
});

test('the block handle does not cover the callout variant button', async ({ page }) => {
  await openEditor(page);
  await page.keyboard.type('/info');
  await page.getByRole('option', { name: 'Callout info', exact: true }).click();
  await page.keyboard.type('Teks callout');

  // The handle follows the caret block, so it is showing next to the callout while the button is used.
  const handle = await page.getByRole('button', { name: 'Opsi blok' }).boundingBox();
  const variant = await page.getByRole('button', { name: 'Jenis callout' }).boundingBox();
  if (handle === null || variant === null) throw new Error('the handle and the variant button must both be on screen');
  const overlaps =
    handle.x < variant.x + variant.width &&
    handle.x + handle.width > variant.x &&
    handle.y < variant.y + variant.height &&
    handle.y + handle.height > variant.y;
  expect(overlaps, 'the block handle sits on top of the callout variant button').toBe(false);

  await page.getByRole('button', { name: 'Jenis callout' }).click({ timeout: 5000 });
  await page.getByRole('menuitemradio', { name: 'Peringatan' }).click();
  await expect(editorOf(page).locator('[data-callout]')).toHaveAttribute('data-variant', 'warning');
});

// The gap above the second block of each neighbouring pair: 12 between text, 16 around a bordered or filled block, 24 around a
// divider, heading tops 32/24/20, and a heading keeps 12 to whatever follows it, even a surface.
const BLOCK_GAPS: Record<string, number> = {
  'p>p': 12,
  'h2>p': 12,
  'h3>list': 12,
  'h4>p': 12,
  'p>list': 12,
  'list>p': 12,
  'p>code': 16,
  'code>p': 16,
  'code>code': 16,
  'p>quote': 16,
  'quote>quote': 16,
  'quote>p': 16,
  'p>table': 16,
  'table>p': 16,
  'p>callout': 16,
  'callout>p': 16,
  'p>hr': 24,
  'hr>p': 24,
  'h3>code': 12,
  'h3>table': 12,
  'h3>quote': 12,
  'h2>h3': 24,
  'p>h3': 24,
  'code>h3': 24,
  'table>h3': 24,
  'quote>h2': 32,
  'list>h4': 20,
};

const BLOCK_RHYTHM_HTML =
  '<h2>Bagian</h2><p>Satu</p><p>Dua</p><pre><code>kode</code></pre><p>Sesudah kode</p>' +
  '<ul><li><p>Butir</p><ul><li><p>Dalam</p></li></ul></li><li><p>Kedua</p></li></ul><p>Sesudah daftar</p>' +
  '<blockquote><p>Petikan satu</p><p>Petikan dua</p></blockquote><blockquote><p>Petikan lain</p></blockquote><p>Sesudah kutipan</p>' +
  '<table><tbody><tr><th><p>Kolom</p></th></tr><tr><td><p>Data</p><p>Baris dua</p></td></tr></tbody></table><p>Sesudah tabel</p>' +
  '<div data-callout="" data-variant="info"><p>Isi satu</p><p>Isi dua</p></div><p>Sesudah callout</p>' +
  '<pre><code>a</code></pre><pre><code>b</code></pre><p>Sebelum pemisah</p><hr><p>Sesudah pemisah</p>' +
  '<h3>Anak</h3><pre><code>c</code></pre><h3>Tabel</h3><table><tbody><tr><th><p>H</p></th></tr><tr><td><p>d</p></td></tr></tbody></table>' +
  '<h3>Kutipan</h3><blockquote><p>e</p></blockquote><h2>Bagian dua</h2><h3>Daftar</h3><ul><li><p>f</p></li></ul><h4>Kecil</h4><p>Akhir</p>';

test('every pair of neighbouring blocks keeps one gap', async ({ page }) => {
  await openEditor(page);
  const editor = editorOf(page);
  await pasteHtml(page, BLOCK_RHYTHM_HTML);
  const observed = await editor.evaluate((root) => {
    const kind = (block: Element): string => {
      if (block.matches('.tableWrapper')) return 'table';
      if (block.querySelector('.kb-code-block') !== null) return 'code';
      if (block.querySelector('.kb-callout') !== null) return 'callout';
      if (block.matches('ul, ol')) return 'list';
      if (block.matches('blockquote')) return 'quote';
      return block.tagName.toLowerCase();
    };
    const blocks = Array.from(root.children).filter((block) => block.getBoundingClientRect().height > 0);
    const gaps: Record<string, number[]> = {};
    blocks.slice(1).forEach((block, index) => {
      const previous = blocks[index];
      if (previous === undefined) return;
      const pair = `${kind(previous)}>${kind(block)}`;
      const gap = Math.round(block.getBoundingClientRect().top - previous.getBoundingClientRect().bottom);
      gaps[pair] = [...new Set([...(gaps[pair] ?? []), gap])];
    });
    return gaps;
  });
  for (const [pair, gap] of Object.entries(BLOCK_GAPS)) expect(observed[pair], pair).toEqual([gap]);
  expect(Object.entries(observed).filter(([, gaps]) => gaps.length > 1)).toEqual([]);
});

test('blocks inside lists, quotes, callouts and cells sit half a line apart', async ({ page }) => {
  await openEditor(page);
  await pasteHtml(page, BLOCK_RHYTHM_HTML);
  const nested = await editorOf(page).evaluate((root) => {
    const gapBetween = (first: string, second: string): number => {
      const a = root.querySelector(first);
      const b = root.querySelector(second);
      if (a === null || b === null) throw new Error(`missing ${first} or ${second}`);
      return Math.round(b.getBoundingClientRect().top - a.getBoundingClientRect().bottom);
    };
    return {
      listItems: gapBetween('ul > li:nth-child(1)', 'ul > li:nth-child(2)'),
      nestedList: gapBetween('li > p:first-child', 'li > p + ul'),
      quote: gapBetween('blockquote > p:nth-child(1)', 'blockquote > p:nth-child(2)'),
      callout: gapBetween('[data-callout] p:nth-child(1)', '[data-callout] p:nth-child(2)'),
      cell: gapBetween('td > p:nth-child(1)', 'td > p:nth-child(2)'),
    };
  });
  expect(nested).toEqual({ listItems: 4, nestedList: 8, quote: 10, callout: 8, cell: 8 });
});

// The select is transparent, so the browser's own list was light with light text in dark mode and the languages were unreadable.
test('the code language list has its own readable surface in both themes', async ({ page }) => {
  await openEditor(page);
  await pasteHtml(page, '<pre><code>kode</code></pre>');
  const option = editorOf(page).locator('.kb-code-block select option').first();
  const surfaces = { dark: ['rgb(33, 33, 33)', 'rgb(255, 255, 255)'], light: ['rgb(237, 236, 234)', 'rgb(10, 10, 10)'] } as const;
  for (const theme of ['dark', 'light'] as const) {
    await page.evaluate((value) => document.documentElement.setAttribute('data-theme', value), theme);
    await expect(option).toHaveCSS('background-color', surfaces[theme][0]);
    await expect(option).toHaveCSS('color', surfaces[theme][1]);
  }
});

// The tick used to be drawn on Tiptap's visually hidden label span, which clips it, so a done task showed an empty filled box.
test('a checked task draws its tick on the checkbox itself', async ({ page }) => {
  await openEditor(page);
  await pasteHtml(page, '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Selesai</p></li></ul>');
  const box = editorOf(page).locator('ul[data-type="taskList"] input[type="checkbox"]');
  await expect(box).toBeChecked();
  expect(await box.evaluate((input) => getComputedStyle(input, '::after').content)).toBe('""');
});

test('a details block has one disclosure control and room under its summary', async ({ page }) => {
  await openEditor(page);
  await pasteHtml(
    page,
    '<div data-type="details"><summary>Ringkasan</summary><div data-type="detailsContent"><p>Isi satu</p><p>Isi dua</p></div></div>',
  );
  const details = editorOf(page).locator('[data-type="details"]');
  await details.locator(':scope > button').click();
  await expect(details.getByText('Isi satu')).toBeVisible();
  await expect(details.locator('summary')).toHaveCSS('list-style-type', 'none');
  const gap = await details.evaluate((node) => {
    const summary = node.querySelector('summary');
    const first = node.querySelector('[data-type="detailsContent"] p');
    if (summary === null || first === null) throw new Error('the details block is missing its summary or content');
    return Math.round(first.getBoundingClientRect().top - summary.getBoundingClientRect().bottom);
  });
  expect(gap).toBe(8);
});

test('the callout icon is centred on the first line of its text', async ({ page }) => {
  await openEditor(page);
  await pasteHtml(page, '<div data-callout="" data-variant="info"><p>Isi callout</p></div>');
  const delta = await editorOf(page).evaluate((root) => {
    const icon = root.querySelector('[data-callout] button svg');
    const text = root.querySelector('[data-callout] p');
    if (icon === null || text === null) throw new Error('the callout is missing its icon or text');
    const line = document.createRange();
    line.selectNodeContents(text);
    const first = line.getClientRects()[0];
    if (first === undefined) throw new Error('the callout text has no line box');
    const box = icon.getBoundingClientRect();
    return box.top + box.height / 2 - (first.top + first.height / 2);
  });
  expect(Math.abs(delta)).toBeLessThanOrEqual(1);
});

// Collapsed borders straddle the table edge, so the rounded-corner clip used to cut the outer half off and the bottom edge vanished.
test('a table keeps a full outline inside its rounded corners', async ({ page }) => {
  await openEditor(page);
  await pasteHtml(page, '<table><tbody><tr><th><p>Kolom</p></th></tr><tr><td><p>Data</p></td></tr></tbody></table>');
  const table = editorOf(page).locator('table');
  await expect(table).toHaveCSS('border-collapse', 'separate');
  await expect(table).toHaveCSS('border-bottom-width', '1px');
  await expect(table.locator('tr:last-child td')).toHaveCSS('border-bottom-width', '0px');
});

test('editor blocks line up on the reading column and an empty paragraph keeps its height', async ({ page }) => {
  await openEditor(page);
  const editor = editorOf(page);
  await pasteHtml(page, '<h2>Bagian</h2><p>Awal</p><h3>Kosong</h3><p></p><p>Berikut</p>');
  const leftOffsets = await editor.evaluate((node) => {
    const contentLeft = node.getBoundingClientRect().left + parseFloat(getComputedStyle(node).paddingInlineStart);
    return Array.from(node.querySelectorAll(':scope > :is(h2,h3,h4,p)')).map((block) => block.getBoundingClientRect().left - contentLeft);
  });
  for (const offset of leftOffsets) expect(Math.abs(offset)).toBeLessThanOrEqual(1);
  const blank = editor.locator('h3 + p').filter({ hasText: /^$/ });
  await expect(blank).toBeVisible();
  expect(await blank.evaluate((p) => p.clientHeight)).toBeGreaterThan(0);
});

test('quote and table use the agreed hierarchy', async ({ page }) => {
  await openEditor(page);
  await pasteHtml(page, '<blockquote><p>Petikan</p></blockquote><table><tr><th>Kolom</th></tr><tr><td>Nilai</td></tr></table>');
  const editor = editorOf(page);
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => document.documentElement.setAttribute('data-theme', value), theme);
    await expect(editor.locator('blockquote p')).toHaveCSS('font-size', '20px');
    await expect(editor.locator('blockquote p')).toHaveCSS('line-height', '28px');
    await editor.locator('th').click();
    await editor.locator('td').click({ modifiers: ['Shift'] });
    await expect(editor.locator('.selectedCell')).toHaveCount(2);
    await expect(editor.locator('th p')).toHaveCSS('text-align', 'start');
    await expect(editor.locator('td p')).toHaveCSS('text-align', 'start');
  }
});

test('code selection and edits survive reload', async ({ page }) => {
  await openEditor(page);
  await pasteHtml(page, '<pre><code>  awalan\n    akhir</code></pre>');
  const code = editorOf(page).locator('pre [data-node-view-content]');
  await code.click();
  await page.keyboard.press('End');
  await page.keyboard.press('Shift+Home');
  await page.keyboard.type('pengganti');
  await waitSaved(page);
  await reloadSettled(page);
  await expect(code).toContainText('pengganti');
});

test('existing code follows read-only transitions without remounting the editor', async ({ page }) => {
  await openEditor(page);
  await pasteHtml(page, '<pre><code>contoh</code></pre>');
  const root = editorOf(page);
  const code = root.locator('pre [data-node-view-content]');
  const setEditable = (value: boolean) => root.evaluate((el, editable) => {
    const editor = (el as HTMLElement & { editor: { setEditable(value: boolean): void } }).editor;
    editor.setEditable(editable);
  }, value);
  await setEditable(false);
  await code.click();
  await page.keyboard.type('tidak');
  expect(await code.textContent()).toBe('contoh');
  await setEditable(true);
  await code.click();
  await page.keyboard.press('End');
  await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.type('H');
  expect(await code.textContent()).toBe('contoH');
});

test('slash filtering resets the active option and preserves editor focus', async ({ page }) => {
  await openEditor(page);
  const menu = page.locator('#kb-slash-menu');
  await page.keyboard.type('/');
  await page.keyboard.press('ArrowUp');
  await expect(menu.getByRole('option').last()).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.type('zzzz');
  await expect(menu.getByRole('option')).toHaveCount(0);
  await expect(menu).toHaveText('Tidak ada blok yang cocok');
  await expect(menu).not.toHaveAttribute('aria-activedescendant', /.+/);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(editorOf(page)).toBeFocused();
});

test('table controls expose six actions and restore editor focus', async ({ page }) => {
  await openEditor(page);
  await pasteHtml(page, '<table><tr><th>Kolom</th><th>Kedua</th></tr><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></table>');
  const editor = editorOf(page);
  await editor.locator('td').first().click();
  const toolbar = page.getByRole('toolbar', { name: 'Tabel', exact: true });
  await expect(toolbar).toBeVisible();
  await toolbar.getByRole('button').first().focus();
  await page.keyboard.press('ArrowRight');
  await expect(toolbar.getByRole('button').nth(1)).toBeFocused();
  await page.keyboard.press('End');
  await expect(toolbar.getByRole('button').last()).toBeFocused();
  await page.keyboard.press('Home');
  await expect(toolbar.getByRole('button').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(editor).toBeFocused();
  await toolbar.getByRole('button', { name: 'Tambah baris di bawah', exact: true }).click();
  await expect(editor.locator('tr')).toHaveCount(4);
  await toolbar.getByRole('button', { name: 'Tambah kolom di kanan', exact: true }).click();
  await expect(editor.locator('tr').first().locator('th,td')).toHaveCount(3);
  await toolbar.getByRole('button', { name: 'Hapus baris', exact: true }).click();
  await expect(editor.locator('tr')).toHaveCount(3);
  await toolbar.getByRole('button', { name: 'Hapus kolom', exact: true }).click();
  await expect(editor.locator('tr').first().locator('th,td')).toHaveCount(2);
  await toolbar.getByRole('button', { name: 'Baris judul', exact: true }).click();
  await expect(editor.locator('th')).toHaveCount(0);
  await toolbar.getByRole('button', { name: 'Baris judul', exact: true }).click();
  await expect(editor.locator('th')).toHaveCount(2);
  await toolbar.getByRole('button', { name: 'Hapus tabel', exact: true }).click();
  await expect(editor.locator('table')).toHaveCount(0);
});
