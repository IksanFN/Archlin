export interface TestDbUrls {
  readonly super: string;
  readonly app: string;
  readonly migrator: string;
  readonly backup: string;
}

export interface TestDbServer {
  readonly host: string;
  readonly port: number;
  readonly containerId: string;
}

// Throwaway credentials of the disposable test container; they never leave the test process.
export const TEST_ROLE_PASSWORDS = {
  superuser: 'test-superuser',
  migrator: 'test-migrator',
  app: 'test-app',
  backup: 'test-backup',
} as const;

export function buildTestDbUrls(host: string, port: number, database: string): TestDbUrls {
  const url = (user: string, password: string) => `postgres://${user}:${password}@${host}:${port}/${database}`;
  return {
    super: url('postgres', TEST_ROLE_PASSWORDS.superuser),
    app: url('cortex_app', TEST_ROLE_PASSWORDS.app),
    migrator: url('cortex_migrator', TEST_ROLE_PASSWORDS.migrator),
    backup: url('cortex_backup', TEST_ROLE_PASSWORDS.backup),
  };
}

// Lowercase identifier only: the name is passed to psql as a variable and used as a database name.
export function assertDatabaseName(name: string): void {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) {
    throw new Error(`Invalid test database name: ${name}`);
  }
}

// Values the integration global setup provides to every test file (read with `inject('testDb')`).
declare module 'vitest' {
  export interface ProvidedContext {
    testDb: TestDbUrls;
    testDbServer: TestDbServer;
  }
}
