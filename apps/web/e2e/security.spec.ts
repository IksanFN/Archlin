import { expect, request as playwrightRequest, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { resetAccount } from './helpers/db';
import { driveAuthedFlows } from './helpers/drive-flows';
import { ACCOUNT, completeSetup, fillSetupForm, gotoSettled } from './helpers/flows';
import { recordServerFns } from './helpers/server-fn-recorder';
import type { RecordedCall } from './helpers/server-fn-recorder';

const BASE_URL = 'http://localhost:3100';

test.beforeEach(async () => {
  await resetAccount();
});

// The four public server functions, learned by driving the screens as a visitor instead of hard-coding their ids.
async function learnPublicUrls(page: Page): Promise<Set<string>> {
  const recorder = recordServerFns(page);
  await gotoSettled(page, '/setup');
  await fillSetupForm(page, 'bukan-kode-setup');
  await page.getByRole('button', { name: 'Buat akun' }).click();
  await expect(page.getByText('Kode setup tidak cocok.')).toBeVisible();
  // Copied now: the account set-up below also makes signed-in calls, which are not public.
  const setupUrls = recorder.calls().map((call) => call.url);

  await completeSetup(page);
  const cleanContext = await page.context().browser()?.newContext();
  if (cleanContext === undefined) throw new Error('no browser to open a visitor context');
  try {
    const visitor = await cleanContext.newPage();
    const visitorRecorder = recordServerFns(visitor);
    await visitor.goto('/login');
    await visitor.getByLabel('Email').fill(ACCOUNT.email);
    await visitor.getByLabel('Password', { exact: true }).fill('salah-0123456789');
    await visitor.getByRole('button', { name: 'Masuk' }).click();
    await expect(visitor.getByText('Email atau password salah.')).toBeVisible();
    await visitor.goto('/login/totp');
    await visitor.getByLabel('Kode verifikasi').fill('123456');
    await visitor.getByRole('button', { name: 'Verifikasi' }).click();
    // Without a challenge cookie the server answers challenge_expired and the client moves to /login, so the sign-in
    // guard asks for the account state over HTTP as well.
    await expect(visitor).toHaveURL(/alasan=verifikasi-habis/);
    return new Set([...setupUrls, ...visitorRecorder.calls().map((call) => call.url)]);
  } finally {
    await cleanContext.close();
  }
}

// The payload is a seroval tree: an object node lists its keys in p.k and its values in p.v, so adding a key means
// appending to both.
function withExtraKey(body: string): string {
  const root: unknown = JSON.parse(body);
  let added = false;
  const visit = (node: unknown): void => {
    if (typeof node !== 'object' || node === null) return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const record = node as Record<string, unknown>;
    const p = record.p as { k?: unknown; v?: unknown } | undefined;
    if (p !== undefined && Array.isArray(p.k) && Array.isArray(p.v) && p.k.includes('email')) {
      p.k.push('extra');
      p.v.push({ t: 1, s: 'unexpected' });
      added = true;
      return;
    }
    Object.values(record).forEach(visit);
  };
  visit(root);
  if (!added) throw new Error('could not find the input object in the recorded payload');
  return JSON.stringify(root);
}

function distinct(calls: readonly RecordedCall[]): RecordedCall[] {
  const byUrl = new Map<string, RecordedCall>();
  for (const call of calls) if (!byUrl.has(call.url)) byUrl.set(call.url, call);
  return [...byUrl.values()];
}

test('server functions reject requests without a session', async ({ page, browser, request }) => {
  // Walks every screen action twice (once as a visitor, once signed in), which is slow in Firefox.
  test.setTimeout(120_000);
  const publicUrls = await learnPublicUrls(page);
  expect(publicUrls.size).toBe(4);

  await resetAccount();
  const recorder = recordServerFns(page);
  await driveAuthedFlows(page, browser, request, { signOutAtEnd: true });
  const guarded = distinct(recorder.calls()).filter((call) => !publicUrls.has(call.url));
  // Every authenticated function the screens use was exercised; a smaller set means the walk-through stopped early.
  expect(guarded.length).toBeGreaterThanOrEqual(12);

  const visitor = await playwrightRequest.newContext({ baseURL: BASE_URL });
  try {
    for (const call of guarded) {
      // A same-origin request, as the browser would send it, so the CSRF check passes and the missing session is what is judged.
      const response = await visitor.fetch(call.url, {
        method: call.method,
        headers: { ...call.headers, origin: BASE_URL },
        data: call.body,
      });
      expect(response.status(), call.url).toBe(401);
    }
  } finally {
    await visitor.dispose();
  }
});

test('server functions reject a foreign origin', async ({ page, browser, request }) => {
  test.setTimeout(120_000);
  const recorder = recordServerFns(page);
  await driveAuthedFlows(page, browser, request, { signOutAtEnd: false });
  const calls = distinct(recorder.calls());
  expect(calls.length).toBeGreaterThanOrEqual(12);

  for (const call of calls) {
    const response = await page.context().request.fetch(call.url, {
      method: call.method,
      // A browser on another site would also say so in Sec-Fetch-Site, which Firefox records as same-origin here.
      headers: { ...call.headers, origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
      data: call.body,
    });
    expect(response.status(), call.url).toBe(403);
  }
});

test('rejects unknown input keys', async ({ page }) => {
  await completeSetup(page);
  await page.context().clearCookies();
  const recorder = recordServerFns(page);
  await gotoSettled(page, '/login');
  await page.getByLabel('Email').fill(ACCOUNT.email);
  await page.getByLabel('Password', { exact: true }).fill('salah-0123456789');
  await page.getByRole('button', { name: 'Masuk' }).click();
  await expect(page.getByText('Email atau password salah.')).toBeVisible();

  const login = recorder.calls().find((call) => call.body?.includes('email') === true);
  if (login?.body === undefined || login.body === null) throw new Error('the login call was not recorded');
  const tampered = withExtraKey(login.body);

  const response = await page.context().request.fetch(login.url, {
    method: login.method,
    headers: { ...login.headers, origin: BASE_URL },
    data: tampered,
  });
  expect(response.status()).toBe(422);
});

test('serves a nonce-based csp without violations', async ({ page }) => {
  await page.addInitScript(() => {
    const violations: string[] = [];
    Object.defineProperty(window, '__cspViolations', { value: violations });
    document.addEventListener('securitypolicyviolation', (event) => violations.push(`${event.violatedDirective} ${event.blockedURI}`));
  });

  const visit = async (path: string): Promise<void> => {
    const response = await gotoSettled(page, path);
    const csp = response?.headers()['content-security-policy'] ?? '';
    expect(csp, path).toContain("'nonce-");
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce, path).toBeDefined();
    const html = (await response?.text()) ?? '';
    const scripts = html.match(/<script\b[^>]*>/g) ?? [];
    expect(scripts.length, path).toBeGreaterThan(0);
    for (const tag of scripts) expect(tag, `${path}: ${tag}`).toContain(`nonce="${nonce}"`);
    await page.waitForLoadState('networkidle');
    const violations = await page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations);
    expect(violations, path).toEqual([]);
  };

  await visit('/setup');
  await completeSetup(page);
  await visit('/');
  await visit('/settings/security');
});

test('client bundles contain no server-only code', async ({ page }) => {
  const scriptUrls = new Set<string>();
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.origin === BASE_URL && url.pathname.endsWith('.js')) scriptUrls.add(response.url());
  });
  await gotoSettled(page, '/setup');
  await completeSetup(page);
  await gotoSettled(page, '/settings/security');
  await page.waitForLoadState('networkidle');
  expect(scriptUrls.size).toBeGreaterThan(0);

  const forbidden = ['cortex_app', 'set_config(', '@node-rs/argon2', 'TOTP_ENC_KEY', 'pg-boss'];
  for (const url of scriptUrls) {
    const source = await (await page.context().request.get(url)).text();
    for (const needle of forbidden) expect(source, `${url} contains ${needle}`).not.toContain(needle);
  }
});
