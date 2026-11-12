import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkServerEndpoints } from './endpoint-rules';

const SRC = join(import.meta.dirname, '..');
const SOURCE_FILE = /\.(ts|tsx)$/;
const EXCLUDED = /(\.test\.tsx?|\.d\.ts|routeTree\.gen\.ts)$/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return SOURCE_FILE.test(entry.name) && !EXCLUDED.test(entry.name) ? [path] : [];
  });
}

describe('web endpoint architecture', () => {
  it('has no server function or route outside the guarded builders', () => {
    const files = sourceFiles(SRC).map((path) => ({
      path: `src/${relative(SRC, path).split(sep).join('/')}`,
      text: readFileSync(path, 'utf8'),
    }));
    expect(files.some((file) => file.path === 'src/server/fn.ts')).toBe(true);
    expect(checkServerEndpoints(files)).toEqual([]);
  });
});
