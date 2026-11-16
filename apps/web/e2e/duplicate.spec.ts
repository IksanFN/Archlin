import { expect, test } from '@playwright/test';
import { resetAccount } from './helpers/db';
import { completeSetup, gotoSettled } from './helpers/flows';
import { createPage, createSpace, editorOf, insertWikiLink, menu, sidebarTree, waitSaved } from './helpers/knowledge';

test.beforeEach(async () => {
  await resetAccount();
});

test('duplicating a page copies its subpages right after it and redirects internal links', async ({ page }) => {
  await completeSetup(page);
  const { slug } = await createSpace(page, 'Kerja');
  const parent = await createPage(page, { space: slug, type: 'Quick Note', title: 'Induk' });
  const child = await createPage(page, { space: slug, parentTitle: 'Induk', type: 'Quick Note', title: 'Anak' });
  await gotoSettled(page, parent.url);
  await insertWikiLink(page, 'Anak', 'Anak');
  await waitSaved(page);
  await menu(page, 'Duplikat');
  await expect(page.getByText('Halaman diduplikasi (2 halaman).')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Judul' })).toHaveValue('Induk (salinan)');
  // One innerText read of the whole tree: bulk reads such as allTextContents can crash the Firefox page.
  const rows = (await sidebarTree(page).innerText())
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('Induk'));
  expect(rows.slice(0, 2)).toEqual(['Induk', 'Induk (salinan)']);
  await editorOf(page).getByRole('link', { name: 'Anak' }).click();
  await expect(page).not.toHaveURL(new RegExp(`/p/${child.entityId}$`));
  await expect(page.getByRole('textbox', { name: 'Judul' })).toHaveValue('Anak');
});
