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
    ],
  },
});
