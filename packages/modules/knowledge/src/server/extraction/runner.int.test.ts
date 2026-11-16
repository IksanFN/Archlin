import { describe, expect, it } from 'vitest';
import { createChildProcessRunner } from './runner';

const childUrl = (name: string): URL => new URL(`./test-children/${name}`, import.meta.url);

const streamOf = (text: string): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });

const runner = (child: string, timeoutMs = 5_000) =>
  createChildProcessRunner({ entry: childUrl(child), timeoutMs, maxOldSpaceMb: 64 });

describe('child process runner', () => {
  it('a hanging child is killed at the timeout and reported as timeout', async () => {
    const started = Date.now();
    expect(await runner('hang-child.mjs', 500).run({ mime: 'application/pdf', bytes: streamOf('x') }, new AbortController().signal)).toEqual({
      status: 'failed',
      error: 'timeout',
    });
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('a child that exits without answering is reported as crashed', async () => {
    expect(await runner('crash-child.mjs').run({ mime: 'text/plain', bytes: streamOf('x') }, new AbortController().signal)).toEqual({
      status: 'failed',
      error: 'crashed',
    });
  });

  it('an answer that fails the schema is reported as crashed', async () => {
    expect(await runner('bad-answer-child.mjs').run({ mime: 'text/plain', bytes: streamOf('x') }, new AbortController().signal)).toEqual({
      status: 'failed',
      error: 'crashed',
    });
  });

  it('echo-child answers with the bytes it read as text', async () => {
    expect(await runner('echo-child.mjs').run({ mime: 'text/plain', bytes: streamOf('halo dari stdin') }, new AbortController().signal)).toEqual({
      status: 'done',
      text: 'halo dari stdin',
    });
  });

  it('a large body reaches the child intact', async () => {
    const text = 'abcdefghij'.repeat(90_000);
    expect(await runner('echo-child.mjs', 20_000).run({ mime: 'text/plain', bytes: streamOf(text) }, new AbortController().signal)).toEqual({
      status: 'done',
      text,
    });
  });

  it('an aborted signal kills the child and rejects so the caller writes nothing', async () => {
    const controller = new AbortController();
    const running = runner('hang-child.mjs', 30_000).run({ mime: 'text/plain', bytes: streamOf('x') }, controller.signal);
    setTimeout(() => controller.abort(), 200);
    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('a signal that is already aborted never starts a child', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(runner('echo-child.mjs').run({ mime: 'text/plain', bytes: streamOf('x') }, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});
