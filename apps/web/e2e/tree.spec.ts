import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { resetAccount } from './helpers/db';
import { completeSetup, gotoSettled, reloadSettled } from './helpers/flows';
import { createPage, createSpace, sidebarTree, treeRow } from './helpers/knowledge';

const TRASH_BANNER = 'Halaman ini ada di Trash. Isinya hanya bisa dibaca.';

test.beforeEach(async () => {
  await resetAccount();
});

// The draggable element is the row inside the treeitem, not the treeitem that also holds the children.
const innerRow = (page: Page, title: string): Locator => treeRow(page, title).locator('> div').first();

async function expectOrder(page: Page, titles: readonly string[]): Promise<void> {
  await expect
    .poll(
      async () => {
        const tops: number[] = [];
        for (const title of titles) {
          const box = await treeRow(page, title).getByRole('link', { name: title, exact: true }).boundingBox();
          tops.push(box?.y ?? Number.NaN);
        }
        return tops.every((top, index) => index === 0 || (tops[index - 1] ?? Infinity) < top);
      },
      { message: `order of ${titles.join(', ')}` },
    )
    .toBe(true);
}

async function openMenuItem(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Opsi halaman' }).click();
  await page.getByRole('menuitem', { name }).click();
}

test('creates pages nested five levels deep from the tree', async ({ page }) => {
  await completeSetup(page);
  const { slug } = await createSpace(page, 'Kerja');
  const titles = ['Tingkat 1', 'Tingkat 2', 'Tingkat 3', 'Tingkat 4', 'Tingkat 5'];
  let parentTitle: string | null = null;
  for (const title of titles) {
    await createPage(page, { space: slug, type: 'Quick Note', title, ...(parentTitle === null ? {} : { parentTitle }) });
    parentTitle = title;
  }

  const crumb = page.getByRole('navigation', { name: 'Jalur halaman' });
  await expect(crumb.getByRole('link')).toHaveCount(5);
  for (const ancestor of ['Kerja', ...titles.slice(0, 4)]) {
    await expect(crumb.getByRole('link', { name: ancestor, exact: true })).toBeVisible();
  }
  await expect(treeRow(page, 'Tingkat 5')).toHaveAttribute('aria-level', '6');

  await reloadSettled(page);
  await expect(treeRow(page, 'Tingkat 5')).toBeVisible();
  await expect(treeRow(page, 'Tingkat 5')).toHaveAttribute('aria-level', '6');
});

test('drags a page under another page and into another space', async ({ page }) => {
  await completeSetup(page);
  const kerja = await createSpace(page, 'Kerja');
  const rumah = await createSpace(page, 'Rumah');
  await gotoSettled(page, `/s/${kerja.slug}`);
  for (const title of ['Alpha', 'Beta', 'Gamma']) {
    await createPage(page, { space: kerja.slug, type: 'Quick Note', title });
  }
  await expectOrder(page, ['Alpha', 'Beta', 'Gamma']);

  // Top edge of a row drops above it.
  await innerRow(page, 'Gamma').dragTo(innerRow(page, 'Alpha'), { sourcePosition: { x: 6, y: 22 }, targetPosition: { x: 80, y: 3 } });
  await expectOrder(page, ['Gamma', 'Alpha', 'Beta']);
  await reloadSettled(page);
  await expectOrder(page, ['Gamma', 'Alpha', 'Beta']);

  // The middle of a row makes the dragged page its child.
  await innerRow(page, 'Beta').dragTo(innerRow(page, 'Alpha'), { sourcePosition: { x: 6, y: 22 }, targetPosition: { x: 80, y: 22 } });
  await expect(treeRow(page, 'Alpha')).toHaveAttribute('aria-expanded', 'true');
  await expect(treeRow(page, 'Beta')).toHaveAttribute('aria-level', '3');
  await reloadSettled(page);
  await expect(treeRow(page, 'Beta')).toHaveAttribute('aria-level', '3');

  // Dropping on a space row moves the whole page, and its place in the tree survives a reload.
  await innerRow(page, 'Beta').dragTo(sidebarTree(page).locator(`a[href="/s/${rumah.slug}"]`).locator('xpath=ancestor::div[1]'), {
    sourcePosition: { x: 6, y: 22 },
    targetPosition: { x: 80, y: 22 },
  });
  await expect(treeRow(page, 'Alpha')).not.toHaveAttribute('aria-expanded', /.+/);
  await reloadSettled(page);
  await treeRow(page, 'Beta').getByRole('link', { name: 'Beta', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/s/${rumah.slug}/p/`));
  await expect(treeRow(page, 'Beta')).toHaveAttribute('aria-level', '2');
});

test('moves a page with only the keyboard', async ({ page }) => {
  await completeSetup(page);
  const { slug } = await createSpace(page, 'Kerja');
  await createPage(page, { space: slug, type: 'Quick Note', title: 'Alpha' });
  await createPage(page, { space: slug, type: 'Quick Note', title: 'Beta' });

  // Tab from the control before the tree until the roving row takes focus.
  await page.getByRole('button', { name: 'Opsi space' }).focus();
  for (let presses = 0; presses < 12; presses += 1) {
    await page.keyboard.press('Tab');
    if ((await page.evaluate(() => document.activeElement?.getAttribute('role'))) === 'treeitem') break;
  }
  await expect(treeRow(page, 'Beta')).toBeFocused();

  await page.keyboard.press('ArrowUp');
  await expect(treeRow(page, 'Alpha')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(treeRow(page, 'Beta')).toBeFocused();

  await page.keyboard.press('Shift+F10');
  const moveItem = page.getByRole('menuitem', { name: 'Pindahkan ke…' });
  await expect(moveItem).toBeVisible();
  for (let presses = 0; presses < 8 && !(await moveItem.evaluate((node) => node === document.activeElement)); presses += 1) {
    await page.keyboard.press('ArrowDown');
  }
  await expect(moveItem).toBeFocused();
  // An open menu hides the rest of the page from the accessibility tree, so the row is found by CSS.
  await expect(page.locator('[role="treeitem"]').filter({ hasText: 'Beta' }).last()).toHaveAttribute('tabindex', '0');
  await page.keyboard.press('Enter');

  const dialog = page.getByRole('dialog', { name: /Pindahkan/ });
  const picker = dialog.getByRole('tree', { name: 'Halaman dan space' });
  await expect(picker.getByRole('treeitem', { name: 'Alpha' })).toBeVisible();
  for (let presses = 0; presses < 4; presses += 1) {
    await page.keyboard.press('Tab');
    if ((await picker.evaluate((node) => node.contains(document.activeElement)))) break;
  }
  await expect(picker.locator(':focus')).toHaveCount(1);
  await page.keyboard.press('ArrowDown');
  await expect(picker.getByRole('treeitem', { name: 'Alpha' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(picker.getByRole('treeitem', { name: 'Alpha' })).toHaveAttribute('aria-selected', 'true');

  const submit = dialog.getByRole('button', { name: 'Pindahkan', exact: true });
  for (let presses = 0; presses < 4 && !(await submit.evaluate((node) => node === document.activeElement)); presses += 1) {
    await page.keyboard.press('Tab');
  }
  await expect(submit).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();

  await expect(treeRow(page, 'Beta')).toHaveAttribute('aria-level', '3');
  await reloadSettled(page);
  await expect(treeRow(page, 'Beta')).toHaveAttribute('aria-level', '3');
});

test('trashes a subtree and restores it from settings', async ({ page }) => {
  await completeSetup(page);
  const { slug } = await createSpace(page, 'Kerja');
  await createPage(page, { space: slug, type: 'Quick Note', title: 'Induk' });
  await createPage(page, { space: slug, parentTitle: 'Induk', type: 'Quick Note', title: 'Anak satu' });
  await createPage(page, { space: slug, parentTitle: 'Induk', type: 'Quick Note', title: 'Anak dua' });

  await treeRow(page, 'Induk').getByRole('link', { name: 'Induk', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Judul' })).toHaveValue('Induk');
  await openMenuItem(page, 'Pindahkan ke Trash');
  await expect(page.getByText('Halaman ini ada di Trash. Isinya hanya bisa dibaca.')).toBeVisible();
  await expect(treeRow(page, 'Induk')).toBeHidden();

  await page.getByRole('link', { name: 'Pengaturan' }).first().click();
  await page.getByRole('link', { name: 'Trash' }).click();
  await expect(page.getByRole('heading', { name: 'Trash', level: 1 })).toBeVisible();
  await expect(page.getByText('2 sub-halaman')).toBeVisible();

  await page.getByRole('button', { name: 'Pulihkan' }).click();
  await expect(page.getByRole('heading', { name: 'Trash kosong' })).toBeVisible();

  await gotoSettled(page, `/s/${slug}`);
  await expect(treeRow(page, 'Induk')).toBeVisible();
  await expect(treeRow(page, 'Anak satu')).toBeVisible();
  await expect(treeRow(page, 'Anak dua')).toBeVisible();
  await expect(treeRow(page, 'Anak satu')).toHaveAttribute('aria-level', '3');
});

test('undo in the trash toast restores the page', async ({ page }) => {
  await completeSetup(page);
  const { slug } = await createSpace(page, 'Kerja');
  await createPage(page, { space: slug, type: 'Quick Note', title: 'Sementara' });

  await treeRow(page, 'Sementara').getByRole('link', { name: 'Sementara', exact: true }).focus();
  await page.keyboard.press('Delete');
  await expect(page.getByText('“Sementara” dipindahkan ke Trash.')).toBeVisible();
  await expect(treeRow(page, 'Sementara')).toBeHidden();

  await page.getByRole('button', { name: 'Batalkan' }).click();
  await expect(treeRow(page, 'Sementara')).toBeVisible();
  await expect(page.getByText('Halaman ini ada di Trash. Isinya hanya bisa dibaca.')).toBeHidden();
});

test('keys typed in a row icon field stay in the field', async ({ page }) => {
  await completeSetup(page);
  const { slug } = await createSpace(page, 'Kerja');
  await createPage(page, { space: slug, type: 'Quick Note', title: 'Induk' });
  const child = await createPage(page, { space: slug, parentTitle: 'Induk', type: 'Quick Note', title: 'Anak' });

  await treeRow(page, 'Induk').getByRole('button', { name: 'Opsi', exact: true }).first().click();
  await page.getByRole('menuitem', { name: 'Ubah ikon' }).click();
  const field = page.getByLabel('Ketik atau tempel satu emoji');
  await field.fill('ab');
  await field.press('ArrowLeft');
  await field.press('Delete');
  await expect(field).toHaveValue('a');

  await expect(treeRow(page, 'Induk')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText(TRASH_BANNER)).toBeHidden();
  await expect(page).toHaveURL(new RegExp(child.url));
});

test('Enter on a row options button opens its menu and stays on the page', async ({ page }) => {
  await completeSetup(page);
  const { slug } = await createSpace(page, 'Kerja');
  await createPage(page, { space: slug, type: 'Quick Note', title: 'Induk' });
  const current = await createPage(page, { space: slug, type: 'Quick Note', title: 'Prosedur' });

  await treeRow(page, 'Prosedur').focus();
  await page.keyboard.press('ArrowUp');
  await expect(treeRow(page, 'Induk')).toBeFocused();
  await treeRow(page, 'Induk').getByRole('button', { name: 'Opsi', exact: true }).first().focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'Ganti nama' })).toBeVisible();

  // Opening the other row would load its page; once the network is quiet, nothing was opened.
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveURL(new RegExp(current.url));
});

test('Delete trashes the row that has focus, not the one the keyboard left', async ({ page }) => {
  await completeSetup(page);
  const { slug } = await createSpace(page, 'Kerja');
  await createPage(page, { space: slug, type: 'Quick Note', title: 'Alpha' });
  await createPage(page, { space: slug, type: 'Quick Note', title: 'Beta' });

  await treeRow(page, 'Beta').focus();
  await page.keyboard.press('ArrowUp');
  await expect(treeRow(page, 'Alpha')).toBeFocused();
  await treeRow(page, 'Beta').getByRole('link', { name: 'Beta', exact: true }).click();
  await page.keyboard.press('Delete');

  await expect(page.getByText('“Beta” dipindahkan ke Trash.')).toBeVisible();
  await expect(treeRow(page, 'Alpha')).toBeVisible();
});

test('the move picker keeps the arrow keys after a chevron click', async ({ page }) => {
  await completeSetup(page);
  const { slug } = await createSpace(page, 'Kerja');
  await createPage(page, { space: slug, type: 'Quick Note', title: 'Induk' });
  await createPage(page, { space: slug, parentTitle: 'Induk', type: 'Quick Note', title: 'Anak' });
  await createPage(page, { space: slug, type: 'Quick Note', title: 'Lain' });

  await openMenuItem(page, 'Pindahkan ke…');
  const picker = page.getByRole('dialog', { name: /Pindahkan/ }).getByRole('tree');
  const parent = picker.getByRole('treeitem', { name: 'Induk' });
  await parent.locator('button').click();
  await expect(parent).toHaveAttribute('aria-expanded', 'true');
  await expect(picker.getByRole('treeitem', { name: 'Anak' })).toBeVisible();

  await page.keyboard.press('ArrowDown');
  await expect(picker.getByRole('treeitem', { name: 'Anak' })).toBeFocused();
});

test('ArrowRight in the move picker waits for the children to load', async ({ page }) => {
  await completeSetup(page);
  const { slug } = await createSpace(page, 'Kerja');
  await createPage(page, { space: slug, type: 'Quick Note', title: 'Induk' });
  await createPage(page, { space: slug, parentTitle: 'Induk', type: 'Quick Note', title: 'Anak' });
  await createPage(page, { space: slug, type: 'Quick Note', title: 'Lain' });

  await openMenuItem(page, 'Pindahkan ke…');
  const picker = page.getByRole('dialog', { name: /Pindahkan/ }).getByRole('tree');
  const parent = picker.getByRole('treeitem', { name: 'Induk' });
  await parent.click();
  await expect(parent).toBeFocused();

  // The children of Induk arrive late, so the row after it is still its sibling when the second ArrowRight lands.
  let release = (): void => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/_serverFn/**', async (route) => {
    await held;
    await route.continue();
  });
  await page.keyboard.press('ArrowRight');
  await expect(parent).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(parent).toBeFocused();

  release();
  await expect(picker.getByRole('treeitem', { name: 'Anak' })).toBeVisible();
  await page.unrouteAll({ behavior: 'wait' });
  await page.keyboard.press('ArrowRight');
  await expect(picker.getByRole('treeitem', { name: 'Anak' })).toBeFocused();
});

test('a page cannot be moved into its own child', async ({ page, context }) => {
  await completeSetup(page);
  const { slug } = await createSpace(page, 'Kerja');
  await createPage(page, { space: slug, type: 'Quick Note', title: 'Induk' });
  await createPage(page, { space: slug, type: 'Quick Note', title: 'Calon anak' });
  await treeRow(page, 'Induk').getByRole('link', { name: 'Induk', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Judul' })).toHaveValue('Induk');

  // The picker lists "Calon anak" as a free target while this tab still thinks the pages are siblings.
  await openMenuItem(page, 'Pindahkan ke…');
  const dialog = page.getByRole('dialog', { name: /Pindahkan/ });
  const target = dialog.getByRole('treeitem', { name: 'Calon anak' });
  await expect(target).toBeVisible();
  await expect(dialog.getByRole('treeitem', { name: 'Induk' })).toHaveAttribute('aria-disabled', 'true');

  // Another tab makes "Calon anak" a child of "Induk" in the meantime.
  const other = await context.newPage();
  await gotoSettled(other, `/s/${slug}`);
  await treeRow(other, 'Calon anak').getByRole('link', { name: 'Calon anak', exact: true }).click();
  await expect(other.getByRole('textbox', { name: 'Judul' })).toHaveValue('Calon anak');
  await other.getByRole('button', { name: 'Opsi halaman' }).click();
  await other.getByRole('menuitem', { name: 'Pindahkan ke…' }).click();
  const otherDialog = other.getByRole('dialog', { name: /Pindahkan/ });
  await otherDialog.getByRole('treeitem', { name: 'Induk' }).click();
  await otherDialog.getByRole('button', { name: 'Pindahkan', exact: true }).click();
  await expect(otherDialog).toBeHidden();
  await other.close();

  await target.click();
  await dialog.getByRole('button', { name: 'Pindahkan', exact: true }).click();
  await expect(dialog.getByText('Halaman tidak bisa dipindah ke dalam sub-halamannya sendiri.')).toBeVisible();
  await expect(dialog).toBeVisible();
});
