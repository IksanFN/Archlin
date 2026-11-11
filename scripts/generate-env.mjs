import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Dev bootstrap only: creates .env and .env.migrate with fresh secrets. Existing files are never overwritten.
const root = (name) => fileURLToPath(new URL(`../${name}`, import.meta.url));

const files = [
  {
    name: '.env',
    content: [
      'DATABASE_URL=postgres://cortex_app:dev-only-app@127.0.0.1:54329/cortex',
      `TOTP_ENC_KEY=${randomBytes(32).toString('base64')}`,
      `ARCHLIN_SETUP_TOKEN=${randomBytes(32).toString('base64url')}`,
      'ARCHLIN_PUBLIC_ORIGIN=http://localhost:3000',
      'LOG_LEVEL=info',
      '',
    ].join('\n'),
  },
  {
    // Kept apart from .env: only the migrate process may ever hold this credential.
    name: '.env.migrate',
    content: 'MIGRATOR_DATABASE_URL=postgres://cortex_migrator:dev-only-migrator@127.0.0.1:54329/cortex\n',
  },
];

for (const { name, content } of files) {
  const path = root(name);
  if (existsSync(path)) {
    console.log(`${name} already exists, left unchanged`);
  } else {
    writeFileSync(path, content, { flag: 'wx' });
    console.log(`${name} created`);
  }
}
