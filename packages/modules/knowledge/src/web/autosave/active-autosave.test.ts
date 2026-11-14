import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushActiveAutosaves, registerAutosaveFlush } from './active-autosave';

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const off of cleanups.splice(0)) off();
});

function register(flush: () => Promise<unknown>): void {
  cleanups.push(registerAutosaveFlush(flush));
}

describe('flushActiveAutosaves', () => {
  it('waits for every registered flush', async () => {
    const done = { first: false, second: false };
    register(async () => {
      await Promise.resolve();
      done.first = true;
    });
    register(async () => {
      await Promise.resolve();
      done.second = true;
    });
    await flushActiveAutosaves();
    expect(done).toEqual({ first: true, second: true });
  });

  it('resolves when one flush rejects', async () => {
    const second = vi.fn(async () => undefined);
    register(() => Promise.reject(new Error('offline')));
    register(second);
    await expect(flushActiveAutosaves()).resolves.toBeUndefined();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('an unregistered flush is not called', async () => {
    const flush = vi.fn(async () => undefined);
    const off = registerAutosaveFlush(flush);
    off();
    await flushActiveAutosaves();
    expect(flush).not.toHaveBeenCalled();
  });
});
