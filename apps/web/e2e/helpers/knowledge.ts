import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { gotoSettled } from './flows';

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

// Creates a note type from the settings screen and saves its fields; `kind` is the value of the Jenis select.
export async function createNoteType(page: Page, name: string, fields: readonly { label: string; kind?: string }[]): Promise<void> {
  await gotoSettled(page, '/settings/note-types');
  await page.getByRole('button', { name: 'Tipe baru' }).click();
  const dialog = page.getByRole('dialog', { name: 'Tipe baru' });
  await dialog.getByLabel('Nama').fill(name);
  await dialog.getByRole('button', { name: 'Buat tipe' }).click();
  await expect(page).toHaveURL(/\/settings\/note-types\/[0-9a-f-]{36}$/);
  for (const [index, field] of fields.entries()) {
    await page.getByRole('button', { name: 'Tambah field' }).click();
    await page.getByLabel('Label', { exact: true }).nth(index).fill(field.label);
    if (field.kind !== undefined) await page.getByLabel('Jenis', { exact: true }).nth(index).selectOption(field.kind);
  }
  await page.getByRole('button', { name: 'Simpan perubahan' }).click();
  await expect(page.getByRole('button', { name: 'Simpan perubahan' })).toBeHidden();
}

// Opens the page options menu and takes one item. The header scrolls away with a long page, and a menu opened while the
// button is being scrolled back into view is placed from its old position, so the page is brought to the top first.
export async function menu(page: Page, name: string): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole('button', { name: 'Opsi halaman' }).click();
  await page.getByRole('menuitem', { name }).click();
}

export const region = (page: Page, name: string): Locator => page.getByRole('region', { name });

export async function typeInEditor(page: Page, text: string): Promise<void> {
  await editorOf(page).click();
  await page.keyboard.press('End');
  await page.keyboard.type(text);
}

const startsWith = (text: string): RegExp => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);

// Types `[[` and a query at the end of the page, then takes the option named `pick`, or the "link as a new page" option for 'create'.
// A page option is matched from its start: the "link as a new page" row also contains the query and is on screen
// before the suggestions arrive, so a looser match would take it by mistake.
export async function insertWikiLink(page: Page, query: string, pick: string | 'create'): Promise<void> {
  await editorOf(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(`[[${query}`);
  const picker = page.getByRole('listbox', { name: 'Pilih halaman untuk ditautkan' });
  await expect(picker).toBeVisible();
  const name = pick === 'create' ? startsWith(`Tautkan “${query}” sebagai halaman baru`) : startsWith(pick);
  await picker.getByRole('option', { name }).click();
  await expect(picker).toBeHidden();
}

// Pastes html through ProseMirror's own paste path (parse, paste handlers, transform). A synthetic ClipboardEvent is not used:
// Firefox ignores the clipboardData of a constructed event, so the editor would receive an empty paste there.
export async function pasteHtml(page: Page, html: string): Promise<void> {
  await editorOf(page).click();
  await editorOf(page).evaluate((element, markup) => {
    const editor = (element as unknown as { editor?: { view: { pasteHTML(markup: string): boolean } } }).editor;
    if (editor === undefined) throw new Error('the editor is not reachable from its element');
    editor.view.pasteHTML(markup);
  }, html);
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
