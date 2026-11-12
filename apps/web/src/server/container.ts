import '@tanstack/react-start/server-only';
import { qualifiedMigrationNames } from '@archlin/db/migrations';
import { createDatabase, createOwnerUnitOfWork } from '@archlin/db/runtime';
import { systemClock, systemIds } from '@archlin/kernel';
import type { Clock, Logger, OwnerUnitOfWork } from '@archlin/kernel';
import {
  createAccountService,
  createAuthService,
  createLogger,
  createPasswordHasher,
  createSecretBox,
  createTotp,
} from '@archlin/platform/server';
import type { AccountService, AuthDeps, AuthService } from '@archlin/platform/server';
import type { Kysely } from 'kysely';
import { migrationSets } from '../../../../archlin.config';
import { loadWebEnv } from './env';
import type { WebEnv } from './env';
import { createControllableClock } from './test-mode';
import type { ControllableClock } from './test-mode';

export interface WebContainer {
  env: WebEnv;
  logger: Logger;
  db: Kysely<unknown>;
  uow: OwnerUnitOfWork;
  clock: Clock;
  testClock: ControllableClock | null;
  auth: AuthService;
  account: AccountService;
  expectedMigrations: readonly string[];
}

function buildContainer(): WebContainer {
  // Validation also enforces the boot guards: no migrator secret, and no test mode in production (K8).
  const env = loadWebEnv(process.env);
  const logger = createLogger({ level: env.logLevel, service: 'web' });
  const db = createDatabase({
    connectionString: env.databaseUrl,
    applicationName: 'archlin-web',
    onPoolError: (err) => logger.error({ err }, 'database pool error'),
  });
  const uow = createOwnerUnitOfWork(db);
  const testClock = env.testMode ? createControllableClock(new Date()) : null;
  const clock = testClock ?? systemClock;

  const authDeps: AuthDeps = {
    db,
    uow,
    clock,
    ids: systemIds,
    hasher: createPasswordHasher(),
    totp: createTotp(),
    secretBox: createSecretBox(env.totpEncKey),
    logger,
    setupToken: env.setupToken,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };

  return {
    env,
    logger,
    db,
    uow,
    clock,
    testClock,
    auth: createAuthService(authDeps),
    account: createAccountService(authDeps),
    expectedMigrations: qualifiedMigrationNames(migrationSets()),
  };
}

let instance: WebContainer | undefined;

export function getContainer(): WebContainer {
  instance ??= buildContainer();
  return instance;
}
