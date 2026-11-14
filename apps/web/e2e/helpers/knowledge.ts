import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

export const savedLabel = (page: Page): Locator => page.getByText('Tersimpan', { exact: true });

// A problem is also announced in a screen-reader-only live region, so the sighted label is the aria-hidden one.
export const saveProblem = (page: Page, text: string): Locator =>
  page.locator('[data-slot="save-status"] [aria-hidden="true"]').getByText(text, { exact: true });

export const editorOf = (page: Page): Locator => page.getByRole('textbox', { name: 'Isi halaman' });

export const sidebarTree = (page: Page): Locator => page.getByRole('tree', { name: 'Halaman dan space' });

// The treeitem that holds the page row. Ancestors contain the same link, so the last match is the row itself.
export function treeRow(page: Page, title: string): Locator {
  return sidebarTree(page)
    .getByRole('treeitem')
    .filter({ has: page.getByRole('link', { name: title, exact: true }) })
    .last();
}

export function spaceRow(page: Page, slug: string): Locator {
  return sidebarTree(page)
    .getByRole('treeitem')
    .filter({ has: page.locator(`a[href="/s/${slug}"]`) })
    .first();
}

export async function createSpace(page: Page, name: string): Promise<{ slug: string }> {
  await page.getByRole('button', { name: 'Buat space' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Buat space' });
  await dialog.getByLabel('Nama').fill(name);
  await dialog.getByRole('button', { name: 'Buat space' }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/s\/[^/]+$/);
  const slug = new URL(page.url()).pathname.split('/')[2];
  if (slug === undefined || slug === '') throw new Error('expected a space slug in the url after creating a space');
  return { slug };
}

export async function waitSaved(page: Page): Promise<void> {
  await expect(savedLabel(page)).toBeVisible();
}

// Creates the page from the sidebar row's plus button, so it exercises the same menu a user reaches.
export async function createPage(
  page: Page,
  opts: { space: string; parentTitle?: string; type: string; title: string },
): Promise<{ entityId: string; url: string }> {
  const parent = opts.parentTitle === undefined ? spaceRow(page, opts.space) : treeRow(page, opts.parentTitle);
  await parent.getByRole('button', { name: 'Halaman baru' }).first().click();
  await page.getByRole('menuitem', { name: opts.type, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/s/${opts.space}/p/[0-9a-f-]{36}`));
  const entityId = new URL(page.url()).pathname.split('/').at(-1);
  if (entityId === undefined || entityId === '') throw new Error('expected a page id in the url');
  // The router keeps the previous page on screen until the new one has loaded; its heading is the sign the new page is ready.
  await expect(page.getByRole('heading', { level: 1, name: 'Tanpa judul' })).toBeAttached();
  const title = page.getByRole('textbox', { name: 'Judul' });
  await title.fill(opts.title);
  await waitSaved(page);
  await expect(treeRow(page, opts.title)).toBeVisible();
  return { entityId, url: new URL(page.url()).pathname };
}
