import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { resetAccount } from './helpers/db';
import { completeSetup, gotoSettled, reloadSettled } from './helpers/flows';
import { editorOf, pasteHtml, waitSaved } from './helpers/knowledge';

// A 44px target measures as 43.99998 on a fractional device pixel ratio; this absorbs that float noise, not a real shortfall.
const TOUCH_TARGET_PX = 44 - 0.01;

test.beforeEach(async () => {
  await resetAccount();
});

async function expectNoHorizontalScroll(path: string, page: Page): Promise<void> {
  await gotoSettled(page, path);
  await page.waitForLoadState('networkidle');
  const overflow = await page.evaluate(() => {
    const scroller = document.scrollingElement;
    return scroller === null ? 0 : scroller.scrollWidth - window.innerWidth;
  });
  expect(overflow, `${path} scrolls ${overflow}px sideways`).toBeLessThanOrEqual(0);
}

test('title follows container width in both directions', async ({ page }) => {
  await startWithPage(page);
  const title = page.getByRole('textbox', { name: 'Judul' });
  // Titles are saved trimmed, so a value that ends in a space would come back shorter than it went in.
  for (const value of ['Rollback Postgres', '', 'Judul panjang untuk memastikan semua baris tetap terlihat ketika lebar halaman berubah '.repeat(5).trim()]) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await title.fill(value);
    await waitSaved(page);
    await reloadSettled(page);
    // Until the page hydrates the field keeps its server height, which clips a line by a few pixels; the reference is the settled one.
    await expect.poll(() => title.evaluate((node) => node.scrollHeight - node.clientHeight)).toBeLessThanOrEqual(1);
    const wideHeight = await title.evaluate((node) => node.clientHeight);
    for (const width of [390, 767, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect.poll(() => title.evaluate((node) => node.scrollHeight - node.clientHeight)).toBeLessThanOrEqual(1);
      await expect(title).toHaveValue(value);
    }
    // Overflow alone misses a textarea that retained its taller mobile height.
    await expect.poll(() => title.evaluate((node) => node.clientHeight)).toBe(wideHeight);
  }
});

test('list markers stay inside the mobile editor in both themes', async ({ page }, testInfo) => {
  await startWithPage(page);
  await pasteHtml(page, '<ul><li><p>Induk</p><ul><li><p>Anak</p></li></ul></li></ul><ol start="7"><li><p>Nomor tujuh</p></li></ol><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Tugas</p><ul><li><p>Butir dalam tugas</p></li></ul></li></ul>');
  await waitSaved(page);
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => document.documentElement.setAttribute('data-theme', value), theme);
    const editor = editorOf(page);
    for (const list of await editor.locator('ul:not([data-type="taskList"]), ol').all()) {
      await expect(list).not.toHaveCSS('list-style-type', 'none');
      await expect(list.locator(':scope > li').first()).toHaveCSS('display', 'list-item');
      const bounds = await list.boundingBox();
      if (bounds === null) throw new Error('list must be visible');
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    await testInfo.attach(`mobile-list-${theme}`, { body: await editor.screenshot(), contentType: 'image/png' });
  }
});

test('no page scrolls horizontally', async ({ page }) => {
  await expectNoHorizontalScroll('/setup', page);
  await completeSetup(page);
  await expectNoHorizontalScroll('/', page);
  await expectNoHorizontalScroll('/settings/security', page);
  // The account menu lives in the drawer on a phone, so dropping the session cookie is the direct way to sign out here.
  await page.context().clearCookies();
  await expectNoHorizontalScroll('/login', page);
  await expectNoHorizontalScroll('/login/totp', page);
  await expectNoHorizontalScroll('/halaman-yang-tidak-ada', page);
});

test('opens and closes the navigation drawer', async ({ page }) => {
  await completeSetup(page);
  await page.getByRole('button', { name: 'Buka navigasi' }).click();
  const drawer = page.getByRole('dialog', { name: 'Navigasi utama' });
  await expect(drawer.getByRole('link', { name: 'Hari ini' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
});

test('navigation rows are at least 44px tall', async ({ page }) => {
  await completeSetup(page);
  await page.getByRole('button', { name: 'Buka navigasi' }).click();
  const drawer = page.getByRole('dialog', { name: 'Navigasi utama' });
  for (const name of ['Hari ini', 'Pengaturan']) {
    const box = await drawer.getByRole('link', { name }).boundingBox();
    expect(box?.height ?? 0, name).toBeGreaterThanOrEqual(TOUCH_TARGET_PX);
  }
});

test('the block handle follows the tapped block and moves it', async ({ page }) => {
  await completeSetup(page);
  await page.getByRole('button', { name: 'Buka navigasi' }).click();
  await page.getByRole('dialog', { name: 'Navigasi utama' }).getByRole('button', { name: 'Buat space' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Buat space' });
  await dialog.getByLabel('Nama').fill('Kerja');
  await dialog.getByRole('button', { name: 'Buat space' }).click();
  await expect(dialog).toBeHidden();
  await gotoSettled(page, '/s/kerja');
  await page.getByRole('main').getByRole('button', { name: 'Halaman baru' }).first().click();
  await page.getByRole('menuitem', { name: 'Quick Note' }).click();
  await expect(page).toHaveURL(/\/s\/kerja\/p\//);

  const editor = page.getByRole('textbox', { name: 'Isi halaman' });
  await editor.click();
  await page.keyboard.type('satu');
  await page.keyboard.press('Enter');
  await page.keyboard.type('dua');
  await editor.getByText('satu').tap();

  const handle = page.getByRole('button', { name: 'Opsi blok' });
  await expect(handle).toBeVisible();
  // The whole 24px target is on screen and beside the text, not under the thumb's view of the first characters.
  const box = await handle.boundingBox();
  const text = await editor.locator('p').first().boundingBox();
  if (box === null || text === null) throw new Error('the block handle and the paragraph must be on screen');
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.width).toBeGreaterThanOrEqual(24);
  expect(box.x + box.width).toBeLessThanOrEqual(text.x);
  await handle.tap();
  await page.getByRole('menuitem', { name: /Pindah ke bawah/ }).tap();
  await expect(editor.locator('p').first()).toHaveText('dua');
});

// On a phone the tree lives in the navigation drawer, so the first space and page are made from the main screen.
async function startWithPage(page: Page): Promise<string> {
  await completeSetup(page);
  await page.getByRole('button', { name: 'Buka navigasi' }).click();
  await page.getByRole('dialog', { name: 'Navigasi utama' }).getByRole('button', { name: 'Buat space' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Buat space' });
  await dialog.getByLabel('Nama').fill('Kerja');
  await dialog.getByRole('button', { name: 'Buat space' }).click();
  await expect(dialog).toBeHidden();
  await gotoSettled(page, '/s/kerja');
  await page.getByRole('main').getByRole('button', { name: 'Halaman baru' }).first().click();
  await page.getByRole('menuitem', { name: 'Quick Note' }).click();
  await expect(page).toHaveURL(/\/s\/kerja\/p\//);
  await expect(page.getByRole('heading', { level: 1, name: 'Tanpa judul' })).toBeAttached();
  await page.getByRole('textbox', { name: 'Judul' }).fill('Halaman ponsel');
  await expect(page.getByText('Tersimpan', { exact: true })).toBeVisible();
  return new URL(page.url()).pathname;
}

async function openDrawer(page: Page) {
  await page.getByRole('button', { name: 'Buka navigasi' }).click();
  const drawer = page.getByRole('dialog', { name: 'Navigasi utama' });
  await expect(drawer).toBeVisible();
  return drawer;
}

test('the drawer shows the space tree and opens a page', async ({ page }) => {
  await startWithPage(page);
  await gotoSettled(page, '/');

  const drawer = await openDrawer(page);
  const tree = drawer.getByRole('tree', { name: 'Halaman dan space' });
  await expect(tree.getByRole('link', { name: 'Kerja', exact: true })).toBeVisible();
  await tree.getByRole('link', { name: 'Halaman ponsel', exact: true }).click();

  await expect(page).toHaveURL(/\/s\/kerja\/p\//);
  await expect(drawer).toBeHidden();
  await expect(page.getByRole('textbox', { name: 'Judul' })).toHaveValue('Halaman ponsel');
});

test('page and space home have no horizontal overflow', async ({ page }) => {
  const pageUrl = await startWithPage(page);
  await expectNoHorizontalScroll(pageUrl, page);
  await expectNoHorizontalScroll('/s/kerja', page);
  await expectNoHorizontalScroll('/settings/trash', page);
});

test('touch targets of tree actions are at least 44px', async ({ page }) => {
  test.skip(!await page.evaluate(() => matchMedia('(pointer: coarse)').matches), 'Touch layout requires a coarse pointer');
  await startWithPage(page);
  const navigation = await page.getByRole('button', { name: 'Buka navigasi' }).boundingBox();
  expect(navigation?.width ?? 0).toBeGreaterThanOrEqual(TOUCH_TARGET_PX);
  expect(navigation?.height ?? 0).toBeGreaterThanOrEqual(TOUCH_TARGET_PX);
  const drawer = await openDrawer(page);
  const settings = await drawer.getByRole('link', { name: 'Pengaturan', exact: true }).boundingBox();
  expect(settings?.width ?? 0).toBeGreaterThanOrEqual(TOUCH_TARGET_PX);
  expect(settings?.height ?? 0).toBeGreaterThanOrEqual(TOUCH_TARGET_PX);
  const tree = drawer.getByRole('tree', { name: 'Halaman dan space' });
  await expect(tree.getByRole('link', { name: 'Halaman ponsel', exact: true })).toBeVisible();

  for (const name of ['Halaman baru', 'Opsi']) {
    const buttons = tree.getByRole('button', { name, exact: true });
    const count = await buttons.count();
    expect(count, `${name} buttons in the tree`).toBeGreaterThanOrEqual(2);
    for (let index = 0; index < count; index += 1) {
      const box = await buttons.nth(index).boundingBox();
      expect(box?.width ?? 0, `${name} #${index} width`).toBeGreaterThanOrEqual(TOUCH_TARGET_PX);
      expect(box?.height ?? 0, `${name} #${index} height`).toBeGreaterThanOrEqual(TOUCH_TARGET_PX);
      expect(await buttons.nth(index).evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return [rect.left + 1, rect.right - 1].every((x) =>
          node.contains(document.elementFromPoint(x, rect.top + rect.height / 2)));
      }), `${name} #${index} edges belong to this button`).toBe(true);
    }
  }
  const chevron = tree.locator('[data-slot="tree-row"] > div > button').first();
  const box = await chevron.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(TOUCH_TARGET_PX);
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(TOUCH_TARGET_PX);
});

test('history and attachments open as a right sheet and close with their button', async ({ page }) => {
  const pageUrl = await startWithPage(page);
  const cases = [
    { item: 'Riwayat versi', dialog: 'Riwayat versi', close: 'Tutup riwayat versi' },
    { item: 'Lampiran', dialog: 'Lampiran', close: 'Tutup panel lampiran' },
  ];
  for (const { item, dialog, close } of cases) {
    await page.getByRole('button', { name: 'Opsi halaman' }).click();
    await page.getByRole('menuitem', { name: item }).click();
    const sheet = page.getByRole('dialog', { name: dialog });
    await expect(sheet).toBeVisible();
    const viewport = page.viewportSize();
    if (viewport === null) throw new Error('the viewport must have a size');
    // A right sheet ends flush with the right edge once its slide-in has finished.
    await expect
      .poll(
        async () => {
          const box = await sheet.boundingBox();
          return box === null ? 0 : Math.round(box.x + box.width);
        },
        { message: `${item} sheet right edge` },
      )
      .toBe(viewport.width);
    await expectNoHorizontalScroll(pageUrl, page);
    await gotoSettled(page, pageUrl);
    await page.getByRole('button', { name: 'Opsi halaman' }).click();
    await page.getByRole('menuitem', { name: item }).click();
    await page.getByRole('dialog', { name: dialog }).getByRole('button', { name: close }).click();
    await expect(page.getByRole('dialog', { name: dialog })).toBeHidden();
  }
});

test('long code preserves content and is scrollable', async ({ page, context, browserName }) => {
  await startWithPage(page);
  if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const source = '  awalan\n    ' + 'contoh '.repeat(90) + 'akhir';
  await pasteHtml(page, '<pre><code>' + source + '</code></pre>');
  const editor = editorOf(page);
  const pre = editor.locator('pre');
  await expect(pre).toHaveText(source, { useInnerText: false });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const metrics = await pre.evaluate((node) => ({
      left: parseFloat(getComputedStyle(node).paddingLeft),
      right: parseFloat(getComputedStyle(node).paddingRight),
      overflow: node.scrollWidth - node.clientWidth,
      pageOverflow: document.documentElement.scrollWidth - innerWidth,
    }));
    expect(metrics.left).toBeGreaterThanOrEqual(12);
    expect(metrics.right).toBeGreaterThanOrEqual(12);
    expect(metrics.overflow).toBeGreaterThan(0);
    expect(metrics.pageOverflow).toBeLessThanOrEqual(0);
    await pre.focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => pre.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
    await pre.evaluate((node) => { node.scrollLeft = 0; });
  }
  if (browserName === 'chromium') {
    const box = await pre.boundingBox();
    if (box === null) throw new Error('Code block must be visible');
    const session = await context.newCDPSession(page);
    const x = box.x + box.width - 30;
    const y = box.y + box.height / 2;
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let step = 1; step <= 8; step += 1) {
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - step * 20, y }] });
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => pre.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
    await session.detach();
    await editor.getByRole('button', { name: 'Salin', exact: true }).click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied.replaceAll('\r\n', '\n')).toBe(source);
  }
  await pre.locator('[data-node-view-content]').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' tambahan');
  await waitSaved(page);
  await reloadSettled(page);
  await expect(pre).toContainText(' tambahan');
});

test('slash menu stays reachable near viewport edges', async ({ page }) => {
  await startWithPage(page);
  const editor = editorOf(page);
  const menu = page.locator('#kb-slash-menu');
  await pasteHtml(page, '<p>Baris</p>'.repeat(60));
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    for (const paragraph of [editor.locator('p').first(), editor.locator('p').last()]) {
      await paragraph.click();
      await page.keyboard.press('Home');
      await page.keyboard.type('/');
      await expect(menu).toBeVisible();
      const box = await menu.boundingBox();
      if (box === null) throw new Error('Slash menu must be visible');
      expect(box.y).toBeGreaterThanOrEqual(8);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height - 8);
      for (const key of ['ArrowUp', 'ArrowDown']) {
        await page.keyboard.press(key);
        const option = key === 'ArrowUp' ? menu.getByRole('option').last() : menu.getByRole('option').first();
        await expect(option).toHaveAttribute('aria-selected', 'true');
        await expect.poll(() => option.evaluate((node) => {
          const rect = node.getBoundingClientRect();
          const panel = node.closest('[role="listbox"]')?.getBoundingClientRect();
          return panel !== undefined && rect.top >= panel.top && rect.bottom <= panel.bottom;
        })).toBe(true);
      }
      await page.keyboard.press('Escape');
      await expect(menu).toBeHidden();
      await page.keyboard.press('Backspace');
    }
  }
});

test('table controls do not obscure the active row or header', async ({ page }) => {
  await startWithPage(page);
  await pasteHtml(page, '<h3>Tabel Uji</h3><table><tr><th>Kolom</th><th>Kedua</th></tr><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></table><p>Sesudah tabel</p>');
  const editor = editorOf(page);
  const toolbar = page.getByRole('toolbar', { name: 'Tabel', exact: true });
  for (const width of [320, 390, 1024]) {
    await page.setViewportSize({ width, height: 844 });
    for (const index of [0, 2, 4]) {
      const cell = editor.locator('th,td').nth(index);
      await cell.click();
      await expect(toolbar).toBeVisible();
      await expect.poll(async () => {
        const bounds = await toolbar.boundingBox();
        const header = await editor.locator('th').first().boundingBox();
        const active = await cell.boundingBox();
        const heading = await editor.locator('h3').boundingBox();
        const after = await editor.locator('p').filter({ hasText: 'Sesudah tabel' }).boundingBox();
        if (bounds === null || header === null || active === null || heading === null || after === null) return false;
        const overlaps = (box: typeof bounds) => bounds.x < box.x + box.width &&
          bounds.x + bounds.width > box.x && bounds.y < box.y + box.height && bounds.y + bounds.height > box.y;
        return bounds.x >= 8 && bounds.x + bounds.width <= width - 8 && bounds.y >= 8 &&
          bounds.y + bounds.height <= 836 && !overlaps(header) && !overlaps(active) && !overlaps(heading) && !overlaps(after);
      }).toBe(true);
      for (const button of await toolbar.getByRole('button').all()) {
        const box = await button.boundingBox();
        expect(box?.width ?? 0).toBeGreaterThanOrEqual(TOUCH_TARGET_PX);
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(TOUCH_TARGET_PX);
      }
    }
  }
});

test('long table controls reserve a shell viewport and preserve focus across resize', async ({ page }) => {
  await startWithPage(page);
  await page.setViewportSize({ width: 320, height: 568 });
  await pasteHtml(page, '<table><tr><th>Kolom</th><th>Kedua</th></tr>' +
    Array.from({ length: 40 }, (_, index) => `<tr><td>Baris ${index}</td><td>Nilai</td></tr>`).join('') +
    '</table><p>Sesudah tabel</p>');
  const editor = editorOf(page);
  await editor.locator('tr').nth(20).locator('td').first().click();
  const toolbar = page.getByRole('toolbar', { name: 'Tabel', exact: true });
  const dock = page.locator('[data-slot="shell-dock"]');
  const content = page.locator('.shell-content');
  await expect(dock.locator('[data-table-dock]')).toBeVisible();
  for (const row of [0, 20, 40]) {
    await editor.locator('tr').nth(row).locator('th,td').first().click();
    await expect.poll(async () => {
      const controls = await toolbar.boundingBox();
      const viewport = await content.boundingBox();
      return controls !== null && viewport !== null && controls.y >= viewport.y + viewport.height &&
        controls.y + controls.height <= 568;
    }).toBe(true);
  }
  await toolbar.getByRole('button').first().focus();
  await page.keyboard.press('ArrowRight');
  const action = toolbar.getByRole('button').nth(1);
  await expect(action).toBeFocused();
  await page.setViewportSize({ width: 320, height: 3000 });
  await expect(dock.locator('[data-table-dock]')).toHaveCount(0);
  await expect(action).toBeFocused();
  await page.setViewportSize({ width: 320, height: 568 });
  await expect(dock.locator('[data-table-dock]')).toBeVisible();
  await expect(action).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(editor).toBeFocused();
  await editor.locator('p').filter({ hasText: 'Sesudah tabel' }).click();
  await expect(dock).toBeEmpty();
  await expect(content).toHaveCSS('display', 'contents');
});
