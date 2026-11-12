import { expect } from '@playwright/test';
import type { APIRequestContext, Browser, Page } from '@playwright/test';
import { completeSetup, confirmIdentityIfAsked, signIn, signOut, reloadSettled } from './flows';
import { serverNow, totpCode } from './totp';

const NEW_PASSWORD = 'kata-sandi-baru-456-xyz';

// Walks every signed-in screen action once, so a recorder attached to the page sees each authenticated server function.
// The session is left valid unless signOutAtEnd is set.
export async function driveAuthedFlows(
  page: Page,
  browser: Browser,
  request: APIRequestContext,
  options: { signOutAtEnd: boolean },
): Promise<void> {
  await completeSetup(page);
  await page.getByRole('link', { name: 'Pengaturan' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Profil & keamanan' })).toBeVisible();

  // Profile: saves on blur.
  const name = page.getByLabel('Nama tampilan');
  await name.fill('Andra S');
  await name.blur();
  await expect(page.getByText('Profil disimpan.')).toBeVisible();

  // Sessions: a second browser signs in, then is revoked one by one and finally all at once.
  const other = await browser.newContext();
  try {
    const otherPage = await other.newPage();
    await signIn(otherPage);
    await reloadSettled(page);
    const sessions = page.getByRole('region', { name: 'Sesi aktif' });
    await sessions.getByRole('button', { name: 'Cabut' }).click();
    await page.getByRole('dialog', { name: 'Cabut sesi ini?' }).getByRole('button', { name: 'Cabut' }).click();
    await expect(page.getByText('Sesi dicabut.')).toBeVisible();

    await signIn(otherPage);
    await reloadSettled(page);
    await page.getByRole('region', { name: 'Sesi aktif' }).getByRole('button', { name: 'Keluarkan semua' }).click();
    await expect(page.getByText('Sesi lain dikeluarkan.')).toBeVisible();
  } finally {
    await other.close();
  }

  // Two-factor: enable, regenerate the recovery codes, disable.
  await page.getByRole('button', { name: 'Aktifkan', exact: true }).click();
  await confirmIdentityIfAsked(page);
  const enroll = page.getByRole('dialog', { name: 'Aktifkan verifikasi dua langkah' });
  const secret = (await enroll.locator('code').innerText()).trim();
  await enroll.getByLabel('Kode dari aplikasi').fill(await totpCode(secret, await serverNow(request)));
  await enroll.getByRole('button', { name: 'Aktifkan verifikasi' }).click();
  await confirmIdentityIfAsked(page);
  await page.getByRole('dialog', { name: 'Simpan kode cadangan' }).getByRole('button', { name: 'Saya sudah menyimpannya' }).click();

  await page.getByRole('button', { name: 'Buat ulang' }).click();
  await confirmIdentityIfAsked(page, { secret, request });
  await page.getByRole('dialog', { name: 'Simpan kode cadangan' }).getByRole('button', { name: 'Saya sudah menyimpannya' }).click();

  await page.getByRole('button', { name: 'Nonaktifkan', exact: true }).click();
  await page.getByRole('dialog', { name: 'Nonaktifkan verifikasi dua langkah?' }).getByRole('button', { name: 'Nonaktifkan' }).click();
  await confirmIdentityIfAsked(page, { secret, request });
  await expect(page.getByText('Belum aktif. Akun hanya dilindungi password.')).toBeVisible();

  // Password last: it rotates the session and drops the others.
  await page.getByRole('button', { name: 'Ganti password' }).click();
  const change = page.getByRole('dialog', { name: 'Ganti password' });
  await change.getByLabel('Password baru', { exact: true }).fill(NEW_PASSWORD);
  await change.getByLabel('Ulangi password baru').fill(NEW_PASSWORD);
  await change.getByRole('button', { name: 'Simpan password' }).click();
  await confirmIdentityIfAsked(page);
  await expect(page.getByText('Password diganti. Sesi lain sudah dikeluarkan.')).toBeVisible();

  if (options.signOutAtEnd) await signOut(page);
}
