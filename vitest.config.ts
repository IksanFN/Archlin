import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['*.test.ts', 'packages/**/src/**/*.test.ts', 'apps/*/src/**/*.test.ts', 'tooling/**/test/**/*.test.ts'],
          exclude: ['**/*.int.test.ts', '**/node_modules/**'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['packages/**/src/**/*.int.test.ts', 'apps/*/src/**/*.int.test.ts'],
          globalSetup: ['./packages/testing/src/db/global-setup.ts'],
          testTimeout: 60_000,
          hookTimeout: 180_000,
        },
      },
    ],
  },
});
