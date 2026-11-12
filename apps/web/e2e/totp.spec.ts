import { expect, test } from '@playwright/test';
import { ACCOUNT, completeSetup, confirmIdentityIfAsked, enableTotp, readRecoveryCodes, signOut, submitLogin, gotoSettled, reloadSettled } from './helpers/flows';
import { resetAccount } from './helpers/db';
import { advanceClock, serverNow, totpCode } from './helpers/totp';

const THIRTY_SECONDS = 30_000;
const ELEVEN_MINUTES = 11 * 60_000;

test.beforeEach(async () => {
  await resetAccount();
});

test('enables totp and shows recovery codes once', async ({ page, request }) => {
  await completeSetup(page);
  await gotoSettled(page, '/settings/security');
  await page.getByRole('button', { name: 'Aktifkan', exact: true }).click();
  await confirmIdentityIfAsked(page);
  const dialog = page.getByRole('dialog', { name: 'Aktifkan verifikasi dua langkah' });
  await expect(dialog.getByAltText('Kode QR untuk aplikasi authenticator')).toBeVisible();
  const secret = (await dialog.locator('code').innerText()).trim();
  await dialog.getByLabel('Kode dari aplikasi').fill(await totpCode(secret, await serverNow(request)));
  await dialog.getByRole('button', { name: 'Aktifkan verifikasi' }).click();
  await confirmIdentityIfAsked(page);

  const codesDialog = page.getByRole('dialog', { name: 'Simpan kode cadangan' });
  const codes = await readRecoveryCodes(codesDialog);
  expect(codes).toHaveLength(10);
  await codesDialog.getByRole('button', { name: 'Saya sudah menyimpannya' }).click();
  await expect(codesDialog).toBeHidden();

  await reloadSettled(page);
  const html = await page.content();
  for (const code of codes) expect(html).not.toContain(code);
  await expect(page.getByText('Tersisa 10 dari 10.')).toBeVisible();
});

test('signs in with totp', async ({ page, request }) => {
  await completeSetup(page);
  const { secret } = await enableTotp(page, request);
  await signOut(page);
  // The enrollment code used up this time step; the next login needs the next one.
  await advanceClock(request, THIRTY_SECONDS);

  await submitLogin(page);
  await expect(page).toHaveURL('/login/totp');
  await page.getByLabel('Kode verifikasi').fill(await totpCode(secret, await serverNow(request)));
  await page.getByRole('button', { name: 'Verifikasi' }).click();
  await expect(page).toHaveURL('/');
});

test('rejects a reused totp code', async ({ page, request }) => {
  await completeSetup(page);
  const { secret } = await enableTotp(page, request);
  await signOut(page);
  await advanceClock(request, THIRTY_SECONDS);
  const code = await totpCode(secret, await serverNow(request));

  await submitLogin(page);
  await page.getByLabel('Kode verifikasi').fill(code);
  await page.getByRole('button', { name: 'Verifikasi' }).click();
  await expect(page).toHaveURL('/');
  await signOut(page);

  await submitLogin(page);
  await page.getByLabel('Kode verifikasi').fill(code);
  await page.getByRole('button', { name: 'Verifikasi' }).click();
  await expect(page.getByText(/Kode tidak cocok\./)).toBeVisible();
  await expect(page).toHaveURL('/login/totp');
});

test('signs in with a recovery code once', async ({ page, request }) => {
  await completeSetup(page);
  const { recoveryCodes } = await enableTotp(page, request);
  const [code] = recoveryCodes;
  if (code === undefined) throw new Error('no recovery code was shown');
  await signOut(page);

  await submitLogin(page);
  await page.getByRole('button', { name: 'Pakai kode cadangan' }).click();
  await page.getByLabel('Kode cadangan').fill(code);
  await page.getByRole('button', { name: 'Verifikasi' }).click();
  await expect(page).toHaveURL('/');
  await signOut(page);

  await submitLogin(page);
  await page.getByRole('button', { name: 'Pakai kode cadangan' }).click();
  await page.getByLabel('Kode cadangan').fill(code);
  await page.getByRole('button', { name: 'Verifikasi' }).click();
  await expect(page.getByText('Kode cadangan tidak cocok atau sudah dipakai.')).toBeVisible();
});

test('disabling totp requires reauthentication', async ({ page, request }) => {
  await completeSetup(page);
  const { secret } = await enableTotp(page, request);
  // The server clock is frozen, so the ten minute confirmation window has to be moved past explicitly.
  await advanceClock(request, ELEVEN_MINUTES);

  await gotoSettled(page, '/settings/security');
  await page.getByRole('button', { name: 'Nonaktifkan', exact: true }).click();
  await page.getByRole('dialog', { name: 'Nonaktifkan verifikasi dua langkah?' }).getByRole('button', { name: 'Nonaktifkan' }).click();
  const reauth = page.getByRole('dialog', { name: 'Konfirmasi identitas' });
  await expect(reauth).toBeVisible();
  await reauth.getByLabel('Password', { exact: true }).fill(ACCOUNT.password);
  await reauth.getByLabel('Kode verifikasi').fill(await totpCode(secret, await serverNow(request)));
  await reauth.getByRole('button', { name: 'Konfirmasi' }).click();
  await expect(page.getByText('Belum aktif. Akun hanya dilindungi password.')).toBeVisible();
});
