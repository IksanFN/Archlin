import type { Page } from '@playwright/test';

export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

// Headers a replay must not carry over: the session cookie is the thing under test, the rest are set by the HTTP client.
const DROPPED_HEADERS = new Set(['cookie', 'host', 'content-length', 'origin', 'referer', 'connection']);

export function recordServerFns(page: Page): { calls(): readonly RecordedCall[] } {
  const recorded: RecordedCall[] = [];
  page.on('request', (request) => {
    if (!new URL(request.url()).pathname.startsWith('/_serverFn/')) return;
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(request.headers())) {
      if (!DROPPED_HEADERS.has(name.toLowerCase())) headers[name] = value;
    }
    recorded.push({ url: request.url(), method: request.method(), headers, body: request.postData() });
  });
  return { calls: () => recorded };
}
