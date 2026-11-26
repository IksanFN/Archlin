import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Wait } from 'testcontainers';
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

const PROVISION_DATABASE_SQL = '/opt/archlin/provision-database.sql';

const execFileAsync = promisify(execFile);

// import.meta.url keeps the source paths correct on Windows (no hand-built POSIX paths).
const dockerFile = (relative: string): string =>
  fileURLToPath(new URL(`../../../../docker/postgres/${relative}`, import.meta.url));

// Goes through the CLI: over Podman's Windows named pipe the API's exec stream never ends, so container.exec() hangs.
export async function provisionDatabase(containerId: string, name: string): Promise<void> {
  assertDatabaseName(name);
  try {
    await execFileAsync('podman', [
      'exec', containerId, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-v', `db_name=${name}`,
      '-f', PROVISION_DATABASE_SQL,
    ]);
  } catch (err) {
    const stderr = err instanceof Error && 'stderr' in err ? String(err.stderr) : '';
    throw new Error(`Provisioning database ${name} failed: ${stderr}`, { cause: err });
  }
}

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
    // The default also checks the port through exec. The health check already connects over TCP, so it is enough.
    .withWaitStrategy(Wait.forHealthCheck())
    .start();

  const host = container.getHost();
  const port = container.getMappedPort(5432);

  return {
    host,
    port,
    containerId: container.getId(),
    urls: (database) => buildTestDbUrls(host, port, database),
    createDatabase: (name) => provisionDatabase(container.getId(), name),
    async stop() {
      await container.stop();
    },
  };
}
