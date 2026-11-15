import { readFileSync } from 'node:fs';

// The SSR build lists every server function it serves as `"<id>": { functionName: "<name>_createServerFn_handler", ... }`.
const ENTRY = /"([^"]+)":\s*\{\s*functionName:\s*"(\w+?)_createServerFn_handler"/g;

// Maps each served function id to its exported name, so a replay can say which function it judged.
export function serverFnNames(): Map<string, string> {
  const source = readFileSync('.output/server/_ssr/ssr.mjs', 'utf8');
  const names = new Map<string, string>();
  for (const [, id, name] of source.matchAll(ENTRY)) {
    if (id !== undefined && name !== undefined) names.set(id, name);
  }
  if (names.size === 0) throw new Error('no server function manifest found in .output/server/_ssr/ssr.mjs; rebuild the web app');
  return names;
}

export function serverFnId(url: string): string {
  const id = new URL(url).pathname.split('/_serverFn/')[1];
  if (id === undefined || id === '') throw new Error(`not a server function url: ${url}`);
  return id;
}
