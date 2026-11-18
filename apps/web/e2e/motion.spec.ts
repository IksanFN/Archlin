import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { resetAccount } from './helpers/db';
import { completeSetup, gotoSettled, openAccountMenu } from './helpers/flows';
import { createPage, createSpace, editorOf, menu } from './helpers/knowledge';

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
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    await page.emulateMedia({ reducedMotion });
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
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await page.keyboard.press('Backspace');
  }
});

async function openAttachmentsPanel(page: Page): Promise<Locator> {
  await completeSetup(page);
  const { slug } = await createSpace(page, 'Kerja');
  await createPage(page, { space: slug, type: 'Quick Note', title: 'Panel' });
  await menu(page, 'Lampiran');
  const dock = page.locator('.kb-dock');
  await expect(dock).toBeVisible();
  return dock;
}

test('docked panels slide and fade', async ({ page }) => {
  const dock = await openAttachmentsPanel(page);
  // Only transform and opacity change: they skip layout, and "all" would also animate the width.
  expect((await computed(dock, 'transition-property')).split(',').map((name) => name.trim()).sort()).toEqual(['opacity', 'transform']);
  expect(await computed(dock, 'transition-duration')).toBe('0.32s, 0.32s');
});

// Reduced motion is set before the panel opens: a transition already running when the preference changes would finish its slide.
test('docked panels do not slide under reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openAttachmentsPanel(page);
  // The leaving state is only on the element for 240ms, so the probe reads it on the frame after the attribute appears.
  // It is armed before the key press: the promise lives on window and is read afterwards.
  await page.evaluate(() => {
    const element = document.querySelector('.kb-dock');
    if (element === null) throw new Error('the dock is not on screen');
    (window as unknown as { __leaving: Promise<string> }).__leaving = new Promise<string>((resolve) => {
      new MutationObserver(() => requestAnimationFrame(() => resolve(getComputedStyle(element).transform))).observe(element, {
        attributes: true,
        attributeFilter: ['data-leaving'],
      });
    });
  });
  await page.getByRole('button', { name: 'Tutup panel lampiran' }).click();
  expect(await page.evaluate(() => (window as unknown as { __leaving: Promise<string> }).__leaving)).toBe('none');
});

test('the link picker opens without animation', async ({ page }) => {
  await completeSetup(page);
  const { slug } = await createSpace(page, 'Kerja');
  await createPage(page, { space: slug, type: 'Quick Note', title: 'Picker' });
  await editorOf(page).click();
  // The picker lists nothing for an empty query, so one character brings up the create row.
  await page.keyboard.type('[[x');

  const picker = page.getByRole('listbox', { name: 'Pilih halaman untuk ditautkan' });
  await expect(picker).toBeVisible();
  const animated = await picker.evaluate((element) => {
    const names: string[] = [];
    for (let node: Element | null = element; node !== null && node !== document.body; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.animationName !== 'none' || style.transitionProperty.includes('opacity')) names.push(node.tagName);
    }
    return names;
  });
  expect(animated).toEqual([]);
});

// Set the preference before navigation so the first opening cannot start a geometry animation.
test('context card does not animate geometry with reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await completeSetup(page);
  const { slug } = await createSpace(page, 'Gerak terbatas');
  await createPage(page, { space: slug, type: 'Quick Note', title: 'Konteks tanpa gerak' });
  const trigger = page.getByRole('button', { name: 'Kartu Konteks' });
  const content = page.locator('[data-slot="collapsible-content"]');
  for (const expanded of [false, true]) {
    const frames = await trigger.evaluate(async (button) => {
      if (!(button instanceof HTMLButtonElement)) throw new Error('context card trigger is not a button');
      button.click();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const root = button.closest('[data-slot="collapsible"]');
      if (root === null) throw new Error('context card is missing');
      return root.getAnimations({ subtree: true }).flatMap((animation) =>
        animation.effect instanceof KeyframeEffect ? animation.effect.getKeyframes() : [],
      );
    });
    const geometry = ['height', 'width', 'transform', 'translate', 'scale', 'rotate', 'top', 'left', 'right', 'bottom', 'marginTop', 'marginBottom'];
    expect(frames.some((frame) => geometry.some((property) => property in frame))).toBe(false);
    await expect(trigger).toHaveAttribute('aria-expanded', String(expanded));
    if (expanded) await expect(content).toBeVisible();
    else await expect(content).toBeHidden();
  }
});

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`context card handles rapid toggles and keyboard with ${reducedMotion} motion`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    await completeSetup(page);
    const { slug } = await createSpace(page, 'Konteks interaktif');
    await createPage(page, { space: slug, type: 'Quick Note', title: 'Interaksi kartu' });
    const trigger = page.getByRole('button', { name: 'Kartu Konteks' });
    const content = page.locator('[data-slot="collapsible-content"]');
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(content).toBeHidden();
    await expect(trigger).toBeFocused();
    await page.keyboard.press('Space');
    await expect(content).toBeVisible();
    await expect(trigger).toBeFocused();
    for (const expanded of [false, true]) {
      await trigger.evaluate(async (button) => {
        if (!(button instanceof HTMLButtonElement)) throw new Error('context card trigger is not a button');
        button.click();
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        button.click();
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        button.click();
      });
      await expect(trigger).toHaveAttribute('aria-expanded', String(expanded));
      if (expanded) await expect(content).toBeVisible();
      else await expect(content).toBeHidden();
      // Verify the interrupted exit cannot hide content again after the final opening.
      await page.waitForTimeout(250);
      if (expanded) await expect(content).toBeVisible();
      else await expect(content).toBeHidden();
      await expect(trigger).toBeFocused();
    }
  });
}
