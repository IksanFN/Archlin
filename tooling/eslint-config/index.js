import js from '@eslint/js';
import boundaries from 'eslint-plugin-boundaries';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const SOURCE_FILES = ['**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}'];
const LAYERED_FILES = ['packages/**/*.{ts,tsx,js,jsx}', 'apps/**/*.{ts,tsx,js,jsx}', 'tooling/**/*.{ts,tsx,js,jsx}'];
const TEST_FILES = ['packages/**/*.test.{ts,tsx}', 'apps/**/*.test.{ts,tsx}'];
const PACKAGE_AND_APP_FILES = ['packages/**/*.{ts,tsx,js,jsx}', 'apps/**/*.{ts,tsx,js,jsx}'];

// Spec 5.3: element types of the dependency rule. Patterns are relative to rootDir.
const ELEMENTS = [
  { type: 'kernel', pattern: 'packages/kernel', partialMatch: false },
  { type: 'db', pattern: 'packages/db', partialMatch: false },
  { type: 'platform', pattern: 'packages/platform', partialMatch: false },
  { type: 'ui', pattern: 'packages/ui', partialMatch: false },
  { type: 'testing', pattern: 'packages/testing', partialMatch: false },
  { type: 'module', pattern: 'packages/modules/*', capture: ['moduleName'], partialMatch: false },
  { type: 'app', pattern: 'apps/*', capture: ['appName'], partialMatch: false },
  { type: 'tooling', pattern: 'tooling/*', partialMatch: false },
];

const allowTo = (...types) => ({ allow: { to: { element: { type: types } } } });

const DEPENDENCY_POLICIES = [
  { from: { element: { type: 'kernel' } }, ...allowTo('kernel') },
  { from: { element: { type: 'db' } }, ...allowTo('kernel', 'db') },
  { from: { element: { type: 'platform' } }, ...allowTo('kernel', 'db', 'platform') },
  { from: { element: { type: 'ui' } }, ...allowTo('kernel', 'ui') },
  {
    from: { element: { type: 'module' } },
    allow: [
      { to: { element: { type: ['kernel', 'db', 'platform', 'ui'] } } },
      // A module may import files of itself, never of another module (spec 5.3).
      {
        to: {
          element: {
            type: 'module',
            captured: { moduleName: '{{ from.element.captured.moduleName }}' },
          },
        },
      },
    ],
  },
  { from: { element: { type: 'testing' } }, ...allowTo('kernel', 'db', 'platform', 'testing') },
  { from: { element: { type: 'app' } }, ...allowTo('kernel', 'db', 'platform', 'ui', 'testing', 'module', 'app') },
  { from: { element: { type: 'tooling' } }, ...allowTo('tooling') },
];

// packages/testing is test-only support code, so only test files of the other layers may import it.
const TEST_DEPENDENCY_POLICIES = [
  ...DEPENDENCY_POLICIES,
  { from: { element: { type: ['db', 'platform', 'module', 'ui'] } }, ...allowTo('testing') },
];

// Shared by every module subpath rule: flat config replaces a rule of the same name, so later layers must repeat these.
const MODULE_PATH_BANS = [
  { name: '@archlin/kernel/trusted', message: 'Scope tepercaya hanya untuk platform, db, testing, dan apps.' },
  { name: '@archlin/db/runtime', message: 'Modul tidak boleh memakai runtime db secara langsung.' },
  {
    name: '@archlin/db/migrations',
    allowTypeImports: true,
    message: 'Modul hanya boleh mengimpor tipe dari migrasi db.',
  },
];

/**
 * Builds the shared flat ESLint config for the workspace.
 * @param {{ rootDir: string }} options rootDir is the absolute path that element patterns are relative to.
 * @returns {import('eslint').Linter.Config[]}
 */
export default function createEslintConfig({ rootDir }) {
  return [
    {
      ignores: [
        '**/node_modules/**',
        '**/.output/**',
        '**/dist/**',
        '**/.tanstack/**',
        '**/playwright-report/**',
        '**/test-results/**',
        'tooling/eslint-config/test/fixtures/**',
        'apps/web/src/routeTree.gen.ts',
      ],
    },
    js.configs.recommended,
    ...tseslint.configs.strict,
    {
      files: SOURCE_FILES,
      languageOptions: { globals: { ...globals.node } },
      rules: {
        '@typescript-eslint/no-explicit-any': 'error',
        '@typescript-eslint/no-non-null-assertion': 'error',
      },
    },
    {
      files: LAYERED_FILES,
      plugins: { boundaries },
      settings: {
        'boundaries/legacy-templates': false,
        'boundaries/root-path': rootDir,
        'boundaries/elements': ELEMENTS,
        'import/resolver': {
          typescript: {
            alwaysTryTypes: true,
            noWarnOnMultipleProjects: true,
            project: ['packages/*/tsconfig.json', 'apps/*/tsconfig.json', 'tooling/*/tsconfig.json'],
          },
        },
      },
      rules: {
        'boundaries/dependencies': [2, { default: 'disallow', policies: DEPENDENCY_POLICIES }],
      },
    },
    {
      files: TEST_FILES,
      rules: {
        'boundaries/dependencies': [2, { default: 'disallow', policies: TEST_DEPENDENCY_POLICIES }],
      },
    },
    {
      files: PACKAGE_AND_APP_FILES,
      rules: { 'boundaries/no-unknown-files': 2 },
    },
    {
      files: SOURCE_FILES,
      ignores: ['apps/web/src/server/fn.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            paths: [
              {
                name: '@tanstack/react-start',
                importNames: ['createServerFn'],
                message: 'Gunakan authedFn/publicFn dari apps/web/src/server/fn.ts (Bagian 13.4 K2).',
              },
            ],
          },
        ],
      },
    },
    {
      files: ['packages/modules/**/*.{ts,tsx,js,jsx}'],
      rules: {
        '@typescript-eslint/no-restricted-imports': [
          'error',
          {
            paths: MODULE_PATH_BANS,
          },
        ],
      },
    },
    {
      files: ['packages/modules/*/src/shared/**/*.{ts,tsx,js,jsx}'],
      rules: {
        '@typescript-eslint/no-restricted-imports': [
          'error',
          {
            paths: [
              ...MODULE_PATH_BANS,
              { name: 'react', message: 'Kode shared modul tidak boleh mengimpor React.' },
              { name: '@tiptap/react', message: 'Kode shared modul tidak boleh mengimpor React.' },
              { name: '@archlin/platform/server', message: 'Kode shared modul tidak boleh mengimpor server platform.' },
            ],
            patterns: [
              {
                group: ['../server/*', '../web/*', '**/src/server/**', '**/src/web/**', '@archlin/db/*'],
                message: 'Kode shared modul tidak boleh mengimpor server, web, atau db.',
              },
            ],
          },
        ],
      },
    },
    {
      files: ['packages/modules/*/src/web/**/*.{ts,tsx,js,jsx}'],
      rules: {
        '@typescript-eslint/no-restricted-imports': [
          'error',
          {
            paths: [
              ...MODULE_PATH_BANS,
              { name: '@archlin/platform/server', message: 'Kode web modul tidak boleh mengimpor server platform.' },
              { name: '@archlin/platform/migrations', message: 'Kode web modul tidak boleh mengimpor migrasi.' },
            ],
            patterns: [
              {
                group: ['../server/*', '**/src/server/**', '@archlin/db/*'],
                message: 'Kode web modul tidak boleh mengimpor server atau db.',
              },
            ],
          },
        ],
      },
    },
    {
      // Module tests compose the kernel trusted issuer and db runtime; production files keep the bans above.
      files: ['packages/modules/**/*.test.{ts,tsx}'],
      rules: {
        '@typescript-eslint/no-restricted-imports': 'off',
      },
    },
    {
      files: ['apps/web/src/server/**/*.{ts,tsx}'],
      rules: {
        'no-restricted-syntax': [
          'error',
          {
            selector: "MemberExpression[object.name='z'][property.name='object']",
            message: 'Pakai z.strictObject (Bagian 13.4 K4).',
          },
        ],
      },
    },
    {
      files: ['**/*.tsx'],
      ...reactHooks.configs.flat.recommended,
    },
  ];
}
