import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import { inject } from 'vitest';
import { buildTestDbUrls } from './urls';
import type { TestDbUrls } from './urls';
import { PROVISION_DATABASE_SQL } from './test-postgres';

const execFileAsync = promisify(execFile);

// Runs inside a Vitest worker, where the container object of the global setup is not available:
// the docker CLI reaches the same container by id.
export async function createScratchDatabase(): Promise<TestDbUrls> {
  const server = inject('testDbServer');
  const name = `t_${randomBytes(4).toString('hex')}`;
  try {
    await execFileAsync('docker', [
      'exec', server.containerId, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-v', `db_name=${name}`,
      '-f', PROVISION_DATABASE_SQL,
    ]);
  } catch (err) {
    const stderr = err instanceof Error && 'stderr' in err ? String(err.stderr) : '';
    throw new Error(`Provisioning scratch database ${name} failed: ${stderr}`, { cause: err });
  }
  return buildTestDbUrls(server.host, server.port, name);
}
