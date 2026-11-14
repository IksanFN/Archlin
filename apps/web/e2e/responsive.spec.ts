import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { resetAccount } from './helpers/db';
import { completeSetup, gotoSettled } from './helpers/flows';

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
    expect(box?.height ?? 0, name).toBeGreaterThanOrEqual(44);
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

test('touch targets of tree actions are at least 24px', async ({ page }) => {
  await startWithPage(page);
  const drawer = await openDrawer(page);
  const tree = drawer.getByRole('tree', { name: 'Halaman dan space' });
  await expect(tree.getByRole('link', { name: 'Halaman ponsel', exact: true })).toBeVisible();

  for (const name of ['Halaman baru', 'Opsi']) {
    const buttons = tree.getByRole('button', { name, exact: true });
    const count = await buttons.count();
    expect(count, `${name} buttons in the tree`).toBeGreaterThanOrEqual(2);
    for (let index = 0; index < count; index += 1) {
      const box = await buttons.nth(index).boundingBox();
      expect(box?.width ?? 0, `${name} #${index} width`).toBeGreaterThanOrEqual(24);
      expect(box?.height ?? 0, `${name} #${index} height`).toBeGreaterThanOrEqual(24);
    }
  }
});
