import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { fileURLToPath } from 'node:url';
import { assertDatabaseName, buildTestDbUrls, TEST_ROLE_PASSWORDS } from './urls';
import type { TestDbUrls } from './urls';

export interface TestPostgres {
  readonly host: string;
  readonly port: number;
  readonly containerId: string;
  urls(database: string): TestDbUrls;
  createDatabase(name: string): Promise<void>;
  stop(): Promise<void>;
}

export const PROVISION_DATABASE_SQL = '/opt/archlin/provision-database.sql';

// import.meta.url keeps the source paths correct on Windows (no hand-built POSIX paths).
const dockerFile = (relative: string): string =>
  fileURLToPath(new URL(`../../../../docker/postgres/${relative}`, import.meta.url));

export async function startTestPostgres(): Promise<TestPostgres> {
  const container = await new PostgreSqlContainer('pgvector/pgvector:pg17')
    .withUsername('postgres')
    .withPassword(TEST_ROLE_PASSWORDS.superuser)
    .withDatabase('postgres')
    .withEnvironment({
      CORTEX_MIGRATOR_PASSWORD: TEST_ROLE_PASSWORDS.migrator,
      CORTEX_APP_PASSWORD: TEST_ROLE_PASSWORDS.app,
      CORTEX_BACKUP_PASSWORD: TEST_ROLE_PASSWORDS.backup,
    })
    .withCopyFilesToContainer([
      { source: dockerFile('initdb/01-provision.sh'), target: '/docker-entrypoint-initdb.d/01-provision.sh', mode: 0o755 },
      { source: dockerFile('sql/provision-roles.sql'), target: '/opt/archlin/provision-roles.sql' },
      { source: dockerFile('sql/provision-database.sql'), target: PROVISION_DATABASE_SQL },
      { source: dockerFile('sql/recreate-database.sh'), target: '/opt/archlin/recreate-database.sh', mode: 0o755 },
    ])
    .start();

  const host = container.getHost();
  const port = container.getMappedPort(5432);

  return {
    host,
    port,
    containerId: container.getId(),
    urls: (database) => buildTestDbUrls(host, port, database),
    async createDatabase(name) {
      assertDatabaseName(name);
      const result = await container.exec([
        'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-v', `db_name=${name}`, '-f', PROVISION_DATABASE_SQL,
      ]);
      if (result.exitCode !== 0) {
        throw new Error(`Provisioning database ${name} failed (exit ${result.exitCode}): ${result.output}`);
      }
    },
    async stop() {
      await container.stop();
    },
  };
}
