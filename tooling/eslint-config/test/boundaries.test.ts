import { ESLint } from 'eslint';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import createEslintConfig from '../index.js';

const rootDir = fileURLToPath(new URL('./fixtures/repo/', import.meta.url));
const eslint = new ESLint({
  cwd: rootDir,
  overrideConfigFile: true,
  overrideConfig: createEslintConfig({ rootDir }),
  ignore: false,
});

const rulesFor = async (file: string) =>
  (await eslint.lintFiles([file]))[0]?.messages.map((m) => m.ruleId) ?? [];

describe('boundaries', () => {
  it('rejects a module importing another module', async () => {
    expect(await rulesFor('packages/modules/alpha/src/index.ts')).toContain('boundaries/dependencies');
  });
  it('allows a module importing the kernel', async () => {
    expect(await rulesFor('packages/modules/alpha/src/ok.ts')).not.toContain('boundaries/dependencies');
  });
  it('rejects the kernel importing db', async () => {
    expect(await rulesFor('packages/kernel/src/uses-db.ts')).toContain('boundaries/dependencies');
  });
  it('rejects production code in platform importing testing', async () => {
    expect(await rulesFor('packages/platform/src/uses-testing.ts')).toContain('boundaries/dependencies');
  });
  it('allows a platform test file importing testing', async () => {
    expect(await rulesFor('packages/platform/src/uses-testing.test.ts')).not.toContain('boundaries/dependencies');
  });
});
