import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadImageSize } from './image-dialog';

function fakeImage(size?: { width: number; height: number }): HTMLImageElement {
  const image = {
    naturalWidth: size?.width ?? 0,
    naturalHeight: size?.height ?? 0,
    referrerPolicy: '',
    src: '',
    onload: null as ((this: GlobalEventHandlers, event: Event) => unknown) | null,
    onerror: null as OnErrorEventHandler,
  };
  return image as HTMLImageElement;
}

describe('loadImageSize', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('loadImageSize resolves with the natural size', async () => {
    const image = fakeImage({ width: 640, height: 480 });
    const pending = loadImageSize('https://cdn.contoh.id/x.png', 10_000, () => image);
    expect(image.referrerPolicy).toBe('no-referrer');
    expect(image.src).toBe('https://cdn.contoh.id/x.png');
    image.onload?.call(image, new Event('load'));
    await expect(pending).resolves.toEqual({ width: 640, height: 480 });
  });

  it('loadImageSize rejects after the timeout', async () => {
    vi.useFakeTimers();
    const image = fakeImage();
    const pending = loadImageSize('https://cdn.contoh.id/slow.png', 10_000, () => image);
    const assertion = expect(pending).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
  });
});
