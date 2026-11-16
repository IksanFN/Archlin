import '@tanstack/react-start/server-only';
import { qualifiedMigrationNames } from '@archlin/db/migrations';
import { createDatabase, createOwnerUnitOfWork } from '@archlin/db/runtime';
import { buildRegistry, systemClock, systemIds } from '@archlin/kernel';
import type { Clock, EventPublisher, Logger, ModuleRegistry, OwnerUnitOfWork } from '@archlin/kernel';
import { createKnowledgeApi } from '@archlin/modules-knowledge/server';
import type { KnowledgeApi } from '@archlin/modules-knowledge/server';
import {
  createAccountService,
  createAuthService,
  createEventPublisher,
  createLinkService,
  createLocalDiskStorage,
  createLogger,
  createPasswordHasher,
  createSecretBox,
  createSpaceService,
  createTagService,
  createTotp,
  createTreeService,
  PLATFORM_EVENTS,
} from '@archlin/platform/server';
import type {
  AccountService,
  AuthDeps,
  AuthService,
  FileStorage,
  SpaceService,
  TagService,
  TreeService,
} from '@archlin/platform/server';
import type { Kysely } from 'kysely';
import { migrationSets, moduleDrafts } from '../../../../archlin.config';
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
  registry: ModuleRegistry;
  publisher: EventPublisher;
  spaces: SpaceService;
  tree: TreeService;
  tags: TagService;
  files: FileStorage;
  knowledge: KnowledgeApi;
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
  const registry = buildRegistry(moduleDrafts({ ids: systemIds }), PLATFORM_EVENTS);
  const publisher = createEventPublisher({ registry, ids: systemIds, clock });
  const spaces = createSpaceService({ registry, ids: systemIds, clock });
  const tree = createTreeService({ registry, publisher, clock, ids: systemIds });
  const tags = createTagService({ tree, ids: systemIds, clock });
  const files = createLocalDiskStorage(env.filesDir);
  const links = createLinkService({ registry, ids: systemIds, clock });
  const knowledge = createKnowledgeApi({ tree, tags, links, publisher, clock, ids: systemIds });

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
    publisher,
  };

  return {
    env,
    logger,
    db,
    uow,
    clock,
    testClock,
    registry,
    publisher,
    spaces,
    tree,
    tags,
    files,
    knowledge,
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
