import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { resetAccount } from './helpers/db';
import { completeSetup, gotoSettled, openAccountMenu } from './helpers/flows';
import { createPage, createSpace, editorOf } from './helpers/knowledge';

test.beforeEach(async () => {
  await resetAccount();
});

const computed = (locator: Locator, property: string): Promise<string> =>
  locator.evaluate((element, name) => getComputedStyle(element).getPropertyValue(name), property);

async function pressAndHold(page: Page, button: Locator): Promise<void> {
  await button.hover();
  await page.mouse.down();
}

async function release(page: Page): Promise<void> {
  // Moving away first keeps the release from counting as a click on the button.
  await page.mouse.move(0, 0);
  await page.mouse.up();
}

test('buttons scale on press and not under reduced motion', async ({ page }) => {
  await completeSetup(page);
  await gotoSettled(page, '/settings/security');
  const button = page.getByRole('button', { name: 'Ganti password' });

  await expect(button).toBeVisible();
  // Tailwind v4 sets scale and rotate as their own CSS properties, so the transform property itself stays none.
  expect(await computed(button, 'scale')).toBe('none');
  await pressAndHold(page, button);
  await expect.poll(() => computed(button, 'scale')).toBe('0.97');
  await release(page);
  await expect.poll(() => computed(button, 'scale')).toBe('none');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await pressAndHold(page, button);
  // The transition is 120ms; waiting past it proves the press stays flat rather than not having started.
  await page.waitForTimeout(400);
  expect(['none', '1']).toContain(await computed(button, 'scale'));
  await release(page);
});

test('menus open from their trigger', async ({ page }) => {
  await completeSetup(page);
  await openAccountMenu(page);

  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  const { origin, centre } = await menu.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { origin: getComputedStyle(element).transformOrigin, centre: `${box.width / 2}px ${box.height / 2}px` };
  });
  expect(origin).not.toBe(centre);
  expect(origin).not.toBe('50% 50%');
  expect(await computed(menu, 'animation-name')).toBe('enter');
});

test('the segmented control indicator slides', async ({ page }) => {
  await completeSetup(page);
  await gotoSettled(page, '/settings/note-types');
  await page.getByRole('link', { name: 'Runbook' }).click();

  const group = page.getByRole('radiogroup', { name: 'Mode review default' });
  await expect(group).toBeVisible();
  const layer = group.locator('xpath=following-sibling::div[@aria-hidden="true"]');
  const before = await computed(layer, 'clip-path');
  const current = await group.getByRole('radio', { checked: true }).innerText();
  const other = current === 'Harian' ? 'Tidak ada' : 'Harian';

  await group.getByRole('radio', { name: other }).click();
  await expect.poll(() => computed(layer, 'clip-path')).not.toBe(before);
});

test('the context card folds with its chevron', async ({ page }) => {
  await completeSetup(page);
  const { slug } = await createSpace(page, 'Kerja');
  await createPage(page, { space: slug, type: 'Quick Note', title: 'Kartu' });

  const trigger = page.getByRole('button', { name: 'Kartu Konteks' });
  const chevron = trigger.locator('[data-slot="collapsible-chevron"]');
  const content = page.locator('[data-slot="collapsible-content"]');
  await expect(content).toHaveAttribute('data-state', 'open');
  const open = await computed(chevron, 'rotate');

  await trigger.click();
  await expect(content).toHaveAttribute('data-state', 'closed');
  await expect.poll(() => computed(chevron, 'rotate')).not.toBe(open);
});

test('the slash menu opens without animation', async ({ page }) => {
  await completeSetup(page);
  const { slug } = await createSpace(page, 'Kerja');
  await createPage(page, { space: slug, type: 'Quick Note', title: 'Garis miring' });
  await editorOf(page).click();
  await page.keyboard.type('/');

  const menu = page.getByRole('listbox');
  await expect(menu).toBeVisible();
  // The popup wrapper, not only the list, must stay still: it is what a keyboard user sees appear.
  const animated = await menu.evaluate((element) => {
    const names: string[] = [];
    for (let node: Element | null = element; node !== null && node !== document.body; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.animationName !== 'none' || style.transitionProperty.includes('opacity')) names.push(node.tagName);
    }
    return names;
  });
  expect(animated).toEqual([]);
});
