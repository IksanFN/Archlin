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
