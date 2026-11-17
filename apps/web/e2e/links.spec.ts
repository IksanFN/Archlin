import { expect, test } from '@playwright/test';
import { resetAccount } from './helpers/db';
import { completeSetup, gotoSettled, reloadSettled } from './helpers/flows';
import { createPage, createSpace, editorOf, insertWikiLink, pasteHtml, region, typeInEditor, waitSaved } from './helpers/knowledge';

test.beforeEach(async () => {
  await resetAccount();
});

// The node view puts the state on a wrapper around the link or button, so the state is read from there.
const linkState = (state: string) => `.kb-link-wrap[data-state="${state}"]`;

test('renaming a page keeps the link that points at it', async ({ page }) => {
  await completeSetup(page);
  const { slug } = await createSpace(page, 'Kerja');
  const a = await createPage(page, { space: slug, type: 'Quick Note', title: 'Rollback Postgres' });
  const b = await createPage(page, { space: slug, type: 'Quick Note', title: 'Checklist migrasi' });
  await insertWikiLink(page, 'Rollback', 'Rollback Postgres');
  await waitSaved(page);
  await gotoSettled(page, a.url);
  await page.getByRole('textbox', { name: 'Judul' }).fill('Rollback Postgres 16');
  await waitSaved(page);
  await expect(region(page, 'Disebut di').getByRole('link', { name: 'Checklist migrasi' })).toBeVisible();
  await gotoSettled(page, b.url);
  const link = editorOf(page).getByRole('link', { name: 'Rollback Postgres 16' });
  await expect(link).toBeVisible();
  await expect(editorOf(page).locator(linkState('resolved'))).toHaveCount(1);
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/p/${a.entityId}$`));
});

test('an unresolved link creates its page and connects to it', async ({ page }) => {
  await completeSetup(page);
  const { slug } = await createSpace(page, 'Kerja');
  const source = await createPage(page, { space: slug, type: 'Quick Note', title: 'Catatan rapat' });
  await insertWikiLink(page, 'Halaman Baru', 'create');
  await waitSaved(page);
  const pending = editorOf(page).getByRole('button', { name: 'Halaman Baru' });
  await expect(editorOf(page).locator(linkState('unresolved'))).toHaveCount(1);
  await pending.click();
  await expect(page.getByText('Halaman “Halaman Baru” belum ada.')).toBeVisible();
  await page.getByRole('button', { name: 'Buat halaman' }).click();
  await expect(page).not.toHaveURL(new RegExp(`/p/${source.entityId}$`));
  await expect(page.getByRole('textbox', { name: 'Judul' })).toHaveValue('Halaman Baru');
  await expect(region(page, 'Disebut di').getByRole('link', { name: 'Catatan rapat' })).toBeVisible();
  await gotoSettled(page, source.url);
  await expect(editorOf(page).getByRole('link', { name: 'Halaman Baru' })).toBeVisible();
  await expect(editorOf(page).locator(linkState('resolved'))).toHaveCount(1);
});

test('a mention links to the picked page', async ({ page }) => {
  await completeSetup(page);
  const { slug } = await createSpace(page, 'Kerja');
  await createPage(page, { space: slug, type: 'Quick Note', title: 'Rollback Postgres' });
  await createPage(page, { space: slug, type: 'Quick Note', title: 'Indeks' });
  await typeInEditor(page, ' @Rollb');
  await page.getByRole('option', { name: /Rollback Postgres/ }).click();
  await expect(editorOf(page).getByRole('link', { name: '@Rollback Postgres' })).toBeVisible();
  await expect(editorOf(page).locator(linkState('resolved'))).toHaveCount(1);
});

// The picker never builds an ambiguous link (a title that exists is offered as a page), so the test pastes an
// untargeted link, the one UI path that produces it.
test('a title shared by two pages stays unresolved until one is picked', async ({ page }) => {
  await completeSetup(page);
  const { slug } = await createSpace(page, 'Kerja');
  await createPage(page, { space: slug, type: 'Quick Note', title: 'Catatan' });
  await createPage(page, { space: slug, type: 'Quick Note', title: 'catatan' });
  await createPage(page, { space: slug, type: 'Quick Note', title: 'Indeks' });
  await pasteHtml(page, '<p><a data-wiki-link="" data-entity-id="">Catatan</a></p>');
  await waitSaved(page);
  await reloadSettled(page);
  const ambiguous = editorOf(page).getByRole('button', { name: 'Catatan' });
  await expect(editorOf(page).locator(linkState('ambiguous'))).toHaveCount(1);
  await ambiguous.click();
  await expect(page.getByText('Ada beberapa halaman berjudul “Catatan”. Pilih yang dimaksud.')).toBeVisible();
  await page.getByRole('option').first().click();
  await waitSaved(page);
  await expect(editorOf(page).getByRole('link', { name: /Catatan/i })).toBeVisible();
  await expect(editorOf(page).locator(linkState('resolved'))).toHaveCount(1);
});

// A link written while its page sat in trash stays unresolved after the restore; the popover must offer that page,
// not a second one with the same title.
test('an unresolved link to a page restored from trash offers that page instead of creating another', async ({ page }) => {
  await completeSetup(page);
  const { slug } = await createSpace(page, 'Kerja');
  const target = await createPage(page, { space: slug, type: 'Quick Note', title: 'Rapat' });
  await page.getByRole('button', { name: 'Opsi halaman' }).click();
  await page.getByRole('menuitem', { name: 'Pindahkan ke Trash' }).click();
  await expect(page.getByText('Halaman ini ada di Trash. Isinya hanya bisa dibaca.')).toBeVisible();
  const source = await createPage(page, { space: slug, type: 'Quick Note', title: 'Agenda' });
  await pasteHtml(page, '<p><a data-wiki-link="" data-entity-id="">Rapat</a></p>');
  await waitSaved(page);
  await gotoSettled(page, target.url);
  await page.getByRole('button', { name: 'Pulihkan' }).click();
  await expect(page.getByText('Halaman ini ada di Trash. Isinya hanya bisa dibaca.')).toBeHidden();

  await gotoSettled(page, source.url);
  await expect(editorOf(page).locator(linkState('unresolved'))).toHaveCount(1);
  await editorOf(page).getByRole('button', { name: 'Rapat' }).click();
  await expect(page.getByText('Halaman “Rapat” sudah ada. Pilih untuk menautkannya.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Buat halaman' })).toHaveCount(0);
  await page.getByRole('option', { name: /Rapat/ }).click();
  await waitSaved(page);
  await expect(editorOf(page).locator(linkState('resolved'))).toHaveCount(1);
  await editorOf(page).getByRole('link', { name: 'Rapat' }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${target.entityId}$`));
});

// Focus never leaves the editor, so the editor itself must point at the list and at the highlighted option.
test('the link picker exposes the highlighted option through the editor', async ({ page }) => {
  await completeSetup(page);
  const { slug } = await createSpace(page, 'Kerja');
  await createPage(page, { space: slug, type: 'Quick Note', title: 'Rollback Postgres' });
  await createPage(page, { space: slug, type: 'Quick Note', title: 'Indeks' });
  await editorOf(page).click();
  await page.keyboard.type('[[Roll');
  const picker = page.getByRole('listbox', { name: 'Pilih halaman untuk ditautkan' });
  await expect(picker.getByRole('option', { name: /^Rollback Postgres/ })).toBeVisible();
  await expect(editorOf(page)).toHaveAttribute('aria-controls', 'kb-link-listbox');
  await expect(picker).toHaveAttribute('id', 'kb-link-listbox');
  await expect(editorOf(page)).toHaveAttribute('aria-activedescendant', 'kb-link-option-0');
  await page.keyboard.press('ArrowDown');
  await expect(editorOf(page)).toHaveAttribute('aria-activedescendant', 'kb-link-option-1');
  await expect(page.locator('#kb-link-option-1')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape');
  await expect(picker).toBeHidden();
  await expect(editorOf(page)).not.toHaveAttribute('aria-activedescendant', /.*/);
  await expect(editorOf(page)).not.toHaveAttribute('aria-controls', /.*/);
});
