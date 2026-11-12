import { expect } from '@playwright/test';
import type { APIRequestContext, Locator, Page, Response } from '@playwright/test';
import { advanceClock, serverNow, totpCode } from './totp';

export const ACCOUNT = {
  name: 'Andra',
  email: 'andra@archlin.id',
  password: 'kata-sandi-panjang-123',
  setupToken: 'e2e-setup-token-0123456789abcdef01234567',
} as const;

// Playwright's Firefox driver sometimes drops a goto that follows a client-side navigation (NS_BINDING_ABORTED,
// NS_ERROR_FAILURE or a bare unknown error, seen only under the test runner; the same steps pass in a standalone script).
// One retry covers that driver race; any other failure, or a second failure, still fails.
const DRIVER_NAVIGATION_ERROR = /NS_BINDING_ABORTED|NS_ERROR_FAILURE|<unknown error>/;

async function navigateOnce(page: Page, go: () => Promise<Response | null>): Promise<Response | null> {
  await page.waitForLoadState('networkidle');
  try {
    return await go();
  } catch (error) {
    if (!DRIVER_NAVIGATION_ERROR.test(String(error))) throw error;
    return go();
  }
}

export function gotoSettled(page: Page, path: string): Promise<Response | null> {
  return navigateOnce(page, () => page.goto(path));
}

export function reloadSettled(page: Page): Promise<Response | null> {
  return navigateOnce(page, () => page.reload());
}

export async function fillSetupForm(page: Page, setupToken: string = ACCOUNT.setupToken): Promise<void> {
  await page.getByLabel('Nama').fill(ACCOUNT.name);
  await page.getByLabel('Email').fill(ACCOUNT.email);
  await page.getByLabel('Password', { exact: true }).fill(ACCOUNT.password);
  await page.getByLabel('Kode setup').fill(setupToken);
}

export async function completeSetup(page: Page): Promise<void> {
  await gotoSettled(page, '/setup');
  await fillSetupForm(page);
  await page.getByRole('button', { name: 'Buat akun' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page).toHaveURL('/');
}

export async function submitLogin(page: Page, password: string = ACCOUNT.password): Promise<void> {
  await gotoSettled(page, '/login');
  await page.getByLabel('Email').fill(ACCOUNT.email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Masuk' }).click();
}

export async function signIn(page: Page): Promise<void> {
  await submitLogin(page);
  await expect(page).toHaveURL('/');
}

// The trigger is named after the visible display name, so it keeps matching after the owner renames the profile.
export async function openAccountMenu(page: Page): Promise<void> {
  await page.getByRole('button', { name: ACCOUNT.name }).click();
}

export async function signOut(page: Page): Promise<void> {
  await openAccountMenu(page);
  await page.getByRole('menuitem', { name: 'Keluar' }).click();
  await expect(page).toHaveURL(/\/login/);
}

// Some actions ask for the password again (spec 13.4 K1); answer it if the dialog shows up.
export async function confirmIdentityIfAsked(
  page: Page,
  totp?: { secret: string; request: APIRequestContext },
): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'Konfirmasi identitas' });
  try {
    await dialog.waitFor({ state: 'visible', timeout: 1500 });
  } catch {
    // The window was still open, so no confirmation was requested.
    return;
  }
  await dialog.getByLabel('Password', { exact: true }).fill(ACCOUNT.password);
  const codeField = dialog.getByLabel('Kode verifikasi');
  if ((await codeField.count()) > 0) {
    if (totp === undefined) throw new Error('the confirmation asked for a totp code but no secret was given');
    // The previous code used up its time step, so move to the next one.
    await advanceClock(totp.request, 30_000);
    await codeField.fill(await totpCode(totp.secret, await serverNow(totp.request)));
  }
  await dialog.getByRole('button', { name: 'Konfirmasi' }).click();
  await expect(dialog).toBeHidden();
}

// One innerText read of the list: Firefox under Playwright crashes the page on a bulk read of the individual items.
export async function readRecoveryCodes(dialog: Locator): Promise<string[]> {
  const text = await dialog.locator('ul').innerText();
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

export async function enableTotp(page: Page, request: APIRequestContext): Promise<{ secret: string; recoveryCodes: string[] }> {
  await gotoSettled(page, '/settings/security');
  await page.getByRole('button', { name: 'Aktifkan', exact: true }).click();
  await confirmIdentityIfAsked(page);
  const dialog = page.getByRole('dialog', { name: 'Aktifkan verifikasi dua langkah' });
  const secret = (await dialog.locator('code').innerText()).trim();
  await dialog.getByLabel('Kode dari aplikasi').fill(await totpCode(secret, await serverNow(request)));
  await dialog.getByRole('button', { name: 'Aktifkan verifikasi' }).click();
  await confirmIdentityIfAsked(page);
  const codesDialog = page.getByRole('dialog', { name: 'Simpan kode cadangan' });
  const recoveryCodes = await readRecoveryCodes(codesDialog);
  await codesDialog.getByRole('button', { name: 'Saya sudah menyimpannya' }).click();
  await expect(codesDialog).toBeHidden();
  return { secret, recoveryCodes };
}
