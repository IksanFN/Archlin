import { createDatabase, createOwnerUnitOfWork } from '@archlin/db/runtime';
import { systemIds } from '@archlin/kernel';
import type { OwnerUnitOfWork } from '@archlin/kernel';
import {
  createAccountService,
  createAuthService,
  createLogger,
  createPasswordHasher,
  createSecretBox,
  createTotp,
} from '@archlin/platform/server';
import type { AccountService, AuthDeps, AuthService, IssuedSession, RequestMeta } from '@archlin/platform/server';
import type { Kysely } from 'kysely';
import { generate } from 'otplib';
import pg from 'pg';
import { FakeClock } from '../fakes';
import { createPlatformDatabase, resetIdentityData } from '../db';
import type { TestDbUrls } from '../db';
import { createMemoryDestination } from '../logging';
import type { MemoryDestination } from '../logging';

export const TEST_START = new Date('2026-11-11T01:00:00.000Z');
export const TEST_SETUP_TOKEN = 'setup-token-for-tests-0123456789abcdef';
export const SENTINEL = 'SENTINEL-8f3a91c2';
export const TEST_META: RequestMeta = { ip: '203.0.113.7', userAgent: 'vitest' };
export const VALID_SETUP = {
  setupToken: TEST_SETUP_TOKEN,
  displayName: 'Andra',
  email: 'andra@archlin.id',
  password: 'kata-sandi-aman-123',
  timezone: 'Asia/Jakarta',
} as const;

export interface EnrolledTotp {
  readonly secret: string;
  readonly recoveryCodes: readonly string[];
  readonly session: IssuedSession;
  // A valid code for the current harness time plus `offsetSeconds`.
  codeAt(offsetSeconds?: number): Promise<string>;
}

export interface AuthHarness {
  readonly urls: TestDbUrls;
  readonly db: Kysely<unknown>;
  readonly uow: OwnerUnitOfWork;
  readonly clock: FakeClock;
  readonly sleeps: number[];
  readonly logs: MemoryDestination;
  readonly deps: AuthDeps;
  readonly auth: AuthService;
  readonly account: AccountService;
  makeAuth(overrides?: Partial<AuthDeps>): AuthService;
  asMigrator(text: string, params?: unknown[]): Promise<pg.QueryResult>;
  enrollTotp(session: IssuedSession): Promise<EnrolledTotp>;
  reset(): Promise<void>;
  close(): Promise<void>;
}

// One scratch database per test file: files run in parallel, so a shared database would let them truncate each other.
export async function createAuthHarness(): Promise<AuthHarness> {
  const urls = await createPlatformDatabase();
  const db = createDatabase({ connectionString: urls.app, applicationName: 'auth-test', max: 4 });
  const uow = createOwnerUnitOfWork(db);
  const clock = new FakeClock(TEST_START);
  const sleeps: number[] = [];
  const logs = createMemoryDestination();
  const deps: AuthDeps = {
    db,
    uow,
    clock,
    ids: systemIds,
    hasher: createPasswordHasher(),
    totp: createTotp(),
    secretBox: createSecretBox(Buffer.alloc(32, 9).toString('base64')),
    logger: createLogger({ level: 'debug', service: 'auth-test', destination: logs }),
    setupToken: TEST_SETUP_TOKEN,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  };

  return {
    urls,
    db,
    uow,
    clock,
    sleeps,
    logs,
    deps,
    auth: createAuthService(deps),
    account: createAccountService(deps),
    makeAuth: (overrides = {}) => createAuthService({ ...deps, ...overrides }),
    async asMigrator(text, params = []) {
      const client = new pg.Client({ connectionString: urls.migrator });
      await client.connect();
      try {
        return await client.query(text, params);
      } finally {
        await client.end();
      }
    },
    async enrollTotp(session) {
      const account = createAccountService(deps);
      const ctx = await createAuthService(deps).authenticate(session.token);
      const { secret } = await account.beginTotpEnrollment(ctx);
      const code = await generate({ secret, epoch: Math.floor(clock.now().getTime() / 1000) });
      const enabled = await account.confirmTotpEnrollment(ctx, { code }, TEST_META);
      return {
        secret,
        recoveryCodes: enabled.recoveryCodes,
        session: enabled.session,
        codeAt: (offsetSeconds = 0) => generate({ secret, epoch: Math.floor(clock.now().getTime() / 1000) + offsetSeconds }),
      };
    },
    async reset() {
      await resetIdentityData(urls);
      clock.set(TEST_START);
      sleeps.length = 0;
      logs.clear();
    },
    close: () => db.destroy(),
  };
}
