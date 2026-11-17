import { fork } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import type { ExtractResult } from '@archlin/platform/contracts';
import { z } from 'zod';
import { EXTRACTION_LIMITS } from './extractors';

export interface ExtractionRunner {
  run(input: { mime: string; bytes: ReadableStream<Uint8Array> }, signal: AbortSignal): Promise<ExtractResult>;
}

// The only thing a child may tell the parent. Anything else, including a valid shape with the wrong limits, is a crash.
export const extractResultSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('done'), text: z.string().max(EXTRACTION_LIMITS.maxChars) }),
  z.strictObject({ status: z.literal('no_text') }),
  z.strictObject({
    status: z.literal('failed'),
    error: z.enum(['timeout', 'crashed', 'corrupt', 'archive_limits', 'blob_missing']),
  }),
]);

const CRASHED: ExtractResult = { status: 'failed', error: 'crashed' };
const TIMED_OUT: ExtractResult = { status: 'failed', error: 'timeout' };

const abortError = (): Error => new DOMException('Extraction was aborted', 'AbortError');

// The child parses untrusted files, so it gets no secrets: only what Node needs to start (Windows wants SystemRoot) and a temp dir.
const CHILD_ENV_KEYS = ['NODE_ENV', 'SystemRoot', 'SYSTEMROOT', 'windir', 'TEMP', 'TMP', 'TMPDIR'];

function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of CHILD_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

// One short-lived process per file: a library bug, a memory blow-up or an endless loop ends with SIGKILL and costs only
// that file, never the worker. Worker threads could not promise this, because their limits only cover the JS heap.
export function createChildProcessRunner(options: { entry: URL; timeoutMs: number; maxOldSpaceMb: number }): ExtractionRunner {
  const entry = fileURLToPath(options.entry);

  return {
    run({ mime, bytes }, signal) {
      return new Promise<ExtractResult>((resolve, reject) => {
        if (signal.aborted) {
          reject(abortError());
          return;
        }
        const child = fork(entry, [], {
          execArgv: [`--max-old-space-size=${options.maxOldSpaceMb}`],
          env: childEnv(),
          stdio: ['pipe', 'ignore', 'ignore', 'ipc'],
          serialization: 'json',
        });

        let settled = false;
        const settle = (outcome: () => void): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal.removeEventListener('abort', onAbort);
          child.kill('SIGKILL');
          outcome();
        };
        const onAbort = (): void => settle(() => reject(abortError()));
        const timer = setTimeout(() => settle(() => resolve(TIMED_OUT)), options.timeoutMs);
        signal.addEventListener('abort', onAbort, { once: true });

        child.on('error', () => settle(() => resolve(CRASHED)));
        child.once('message', (message) => {
          const answer = extractResultSchema.safeParse(message);
          settle(() => resolve(answer.success ? answer.data : CRASHED));
        });
        // An answer sent just before the exit is still being read from the channel, which closes only after it.
        child.once('disconnect', () => settle(() => resolve(CRASHED)));
        child.once('exit', () => {
          if (!child.connected) settle(() => resolve(CRASHED));
        });

        child.send({ mime, maxChars: EXTRACTION_LIMITS.maxChars }, (error) => {
          if (error) settle(() => resolve(CRASHED));
        });
        // A child that is gone breaks the pipe, and a source that fails would leave it with half a file: both are a crash.
        const { stdin } = child;
        if (stdin === null) {
          settle(() => resolve(CRASHED));
          return;
        }
        pipeline(Readable.fromWeb(bytes as Parameters<typeof Readable.fromWeb>[0]), stdin).catch(() => settle(() => resolve(CRASHED)));
      });
    },
  };
}
