import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Dev bootstrap only: creates .env and .env.migrate with fresh secrets. A value that already exists is never changed:
// on an existing .env only the keys it lacks are appended. Names are printed, values never.
// An optional directory argument exists so the script can be exercised without touching the real files.
const rootDir = process.argv[2] ?? fileURLToPath(new URL('..', import.meta.url));
const at = (name) => `${rootDir.replace(/[\\/]+$/, '')}/${name}`;

const secret = (bytes) => randomBytes(bytes).toString('base64url');

// Order matters only for readability of the generated file.
const ENV_ENTRIES = [
  ['DATABASE_URL', () => 'postgres://cortex_app:dev-only-app@127.0.0.1:54329/cortex'],
  ['TOTP_ENC_KEY', () => randomBytes(32).toString('base64')],
  ['ARCHLIN_SETUP_TOKEN', () => secret(32)],
  ['ARCHLIN_PUBLIC_ORIGIN', () => 'http://localhost:3000'],
  ['LOG_LEVEL', () => 'info'],
  // The local compose stack (pnpm stack:up). Distinct from the dev-only passwords of docker/compose.dev.yml.
  ['POSTGRES_PASSWORD', () => secret(24)],
  ['CORTEX_MIGRATOR_PASSWORD', () => secret(24)],
  ['CORTEX_APP_PASSWORD', () => secret(24)],
  ['CORTEX_BACKUP_PASSWORD', () => secret(24)],
  ['ARCHLIN_STACK_PORT', () => '8080'],
  // Filled with the public key from age-keygen when backups are set up.
  ['BACKUP_AGE_RECIPIENT', () => ''],
  ['BACKUP_TZ', () => 'Asia/Jakarta'],
];

function existingKeys(path) {
  const keys = new Set();
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (match) keys.add(match[1]);
  }
  return keys;
}

const envPath = at('.env');
if (existsSync(envPath)) {
  const present = existingKeys(envPath);
  const missing = ENV_ENTRIES.filter(([key]) => !present.has(key));
  if (missing.length === 0) {
    console.log('.env already has every key, left unchanged');
  } else {
    const current = readFileSync(envPath, 'utf8');
    const prefix = current.length === 0 || current.endsWith('\n') ? '' : '\n';
    appendFileSync(envPath, `${prefix}${missing.map(([key, make]) => `${key}=${make()}`).join('\n')}\n`);
    console.log(`.env: added ${missing.map(([key]) => key).join(', ')}`);
  }
} else {
  writeFileSync(envPath, `${ENV_ENTRIES.map(([key, make]) => `${key}=${make()}`).join('\n')}\n`, { flag: 'wx' });
  console.log('.env created');
}

// Kept apart from .env: only the migrate process may ever hold this credential.
const migratePath = at('.env.migrate');
if (existsSync(migratePath)) {
  console.log('.env.migrate already exists, left unchanged');
} else {
  writeFileSync(migratePath, 'MIGRATOR_DATABASE_URL=postgres://cortex_migrator:dev-only-migrator@127.0.0.1:54329/cortex\n', { flag: 'wx' });
  console.log('.env.migrate created');
}
