import { describe, expect, it } from 'vitest';
import { checkServerEndpoints } from './endpoint-rules';

const check = (path: string, text: string) => checkServerEndpoints([{ path, text }]);
const rulesOf = (path: string, text: string) => check(path, text).map((violation) => violation.rule);

const FN_IMPORT = `import { z } from 'zod';\nimport { authedFn, publicFn, strictInput } from '~/server/fn';\n`;

describe('checkServerEndpoints', () => {
  it('accepts guarded server functions and wrapped route handlers', () => {
    const functions = `${FN_IMPORT}
export const loginFn = publicFn.validator(strictInput(z.strictObject({}))).handler(async () => ({ ok: true }));
export const viewerFn = authedFn.validator(strictInput(z.strictObject({}))).handler(async ({ context }) => context.auth);
`;
    const health = `import { createFileRoute } from '@tanstack/react-router';
import { publicRoute } from '~/server/route-wrappers';
export const Route = createFileRoute('/health')({
  server: { handlers: { GET: publicRoute(async () => new Response('ok')) } },
});
`;
    const capture = `import { createFileRoute } from '@tanstack/react-router';
import { tokenRoute } from '~/server/route-wrappers';
export const Route = createFileRoute('/api/capture')({
  server: { handlers: { POST: tokenRoute('capture:write', schema, async () => new Response('ok')) } },
});
`;
    expect(
      checkServerEndpoints([
        { path: 'src/server/functions/auth.ts', text: functions },
        { path: 'src/routes/health.ts', text: health },
        { path: 'src/routes/api/capture.ts', text: capture },
      ]),
    ).toEqual([]);
  });

  it('flags createServerFn outside fn.ts', () => {
    const text = `import { createServerFn } from '@tanstack/react-start';\nexport const a = createServerFn();\n`;
    expect(rulesOf('src/server/functions/x.ts', text)).toContain('create_server_fn_outside_fn_ts');
    expect(check('src/server/fn.ts', text)).toEqual([]);
  });

  it('flags a handler chained from something other than the guarded builders', () => {
    const other = `import { builder } from './builder';\nimport { strictInput } from '~/server/fn';\nexport const a = builder.validator(strictInput(s)).handler(async () => 1);\n`;
    expect(rulesOf('src/server/functions/x.ts', other)).toContain('handler_without_guarded_builder');

    const localBuilder = `const publicFn = makeFn();\nexport const loginFn = publicFn.validator(strictInput(s)).handler(async () => 1);\n`;
    expect(rulesOf('src/server/functions/y.ts', localBuilder)).toContain('handler_without_guarded_builder');
  });

  it('flags a handler without strictInput validation', () => {
    const noValidator = `${FN_IMPORT}export const viewerFn = authedFn.handler(async () => 1);\n`;
    expect(rulesOf('src/server/functions/x.ts', noValidator)).toEqual(['handler_without_strict_input']);

    const looseValidator = `${FN_IMPORT}export const viewerFn = authedFn.validator((data: unknown) => data).handler(async () => 1);\n`;
    expect(rulesOf('src/server/functions/x.ts', looseValidator)).toEqual(['handler_without_strict_input']);
  });

  it('flags a publicFn that is not on the allowlist', () => {
    const renamed = `${FN_IMPORT}export const sneakyFn = publicFn.validator(strictInput(z.strictObject({}))).handler(async () => 1);\n`;
    expect(rulesOf('src/server/functions/x.ts', renamed)).toEqual(['public_fn_not_allowlisted']);

    const notExported = `${FN_IMPORT}const loginFn = publicFn.validator(strictInput(z.strictObject({}))).handler(async () => 1);\n`;
    expect(rulesOf('src/server/functions/x.ts', notExported)).toEqual(['public_fn_not_allowlisted']);

    const inline = `${FN_IMPORT}export function make() { return publicFn.validator(strictInput(z.strictObject({}))).handler(async () => 1); }\n`;
    expect(rulesOf('src/server/functions/x.ts', inline)).toEqual(['public_fn_not_allowlisted']);
  });

  it('flags a route handler that is not wrapped', () => {
    const bare = `import { createFileRoute } from '@tanstack/react-router';
export const Route = createFileRoute('/x')({ server: { handlers: { GET: async () => new Response('x') } } });
`;
    expect(rulesOf('src/routes/x.ts', bare)).toEqual(['route_handler_not_wrapped']);

    const dynamic = `export const Route = createFileRoute('/x')({ server: { handlers: ({ createHandlers }) => createHandlers({}) } });\n`;
    expect(rulesOf('src/routes/x.ts', dynamic)).toEqual(['route_handler_not_wrapped']);

    const method = `export const Route = createFileRoute('/x')({ server: { handlers: { async GET() { return new Response('x'); } } } });\n`;
    expect(rulesOf('src/routes/x.ts', method)).toEqual(['route_handler_not_wrapped']);
  });

  it('flags publicRoute outside the health route', () => {
    const text = `import { createFileRoute } from '@tanstack/react-router';
import { publicRoute } from '~/server/route-wrappers';
export const Route = createFileRoute('/other')({ server: { handlers: { GET: publicRoute(async () => new Response('x')) } } });
`;
    expect(rulesOf('src/routes/other.ts', text)).toEqual(['public_route_not_allowlisted']);
  });

  it('reports the file and line of each violation', () => {
    const text = `\n\nimport { createServerFn } from '@tanstack/react-start';\n`;
    expect(check('src/server/functions/x.ts', text)).toEqual([
      { file: 'src/server/functions/x.ts', line: 3, rule: 'create_server_fn_outside_fn_ts' },
    ]);
  });

  it('ignores route options that are not file route definitions', () => {
    const text = `export const config = { server: { handlers: { GET: () => 1 } } };\n`;
    expect(check('src/server/config.ts', text)).toEqual([]);
  });
});
