import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLeaving } from './use-leaving';

function hookApi<K>(): ReturnType<typeof useLeaving<K>> {
  let api: ReturnType<typeof useLeaving<K>> | undefined;
  function Probe() {
    api = useLeaving<K>();
    return null;
  }
  renderToString(createElement(Probe));
  if (api === undefined) throw new Error('useLeaving did not initialise');
  return api;
}

describe('useLeaving', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('leave resolves after 150ms', async () => {
    vi.useFakeTimers();
    const { isLeaving, leave } = hookApi<string>();
    const done = leave('row');
    expect(isLeaving('row')).toBe(true);
    expect(isLeaving('other')).toBe(false);
    let resolved = false;
    void done.then(() => {
      resolved = true;
    });
    await vi.advanceTimersByTimeAsync(149);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(resolved).toBe(true);
  });

  it('leave resolves immediately when reduced motion is preferred', async () => {
    vi.stubGlobal('window', {
      matchMedia: () => ({ matches: true }),
    });
    const { leave } = hookApi<string>();
    await expect(leave('row')).resolves.toBeUndefined();
  });

  it('keeps isLeaving true after leave resolves until microtasks flush, including a later leave', async () => {
    vi.useFakeTimers();
    const { isLeaving, leave } = hookApi<string>();
    const done = leave('a');
    const afterLeave = done.then(() => {
      expect(isLeaving('a')).toBe(true);
      void leave('b');
      expect(isLeaving('a')).toBe(true);
      expect(isLeaving('b')).toBe(true);
    });
    await vi.advanceTimersByTimeAsync(150);
    await afterLeave;
  });

  it('releases the mark after microtasks so a remount is not leaving', async () => {
    vi.useFakeTimers();
    const { isLeaving, leave } = hookApi<string>();
    const done = leave('a');
    await vi.advanceTimersByTimeAsync(150);
    await done;
    await Promise.resolve();
    expect(isLeaving('a')).toBe(false);
  });
});
