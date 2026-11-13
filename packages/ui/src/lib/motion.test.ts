import { describe, expect, it } from 'vitest';
import { exitMs, flipDirection, prefersReducedMotion, segmentClipPath, tabIndicatorTransform } from './motion';

function rect(x: number, y: number, width: number, height: number): DOMRectReadOnly {
  if (typeof DOMRect === 'function') return new DOMRect(x, y, width, height);
  return { x, y, width, height, top: y, left: x, right: x + width, bottom: y + height, toJSON: () => ({}) };
}

describe('motion', () => {
  it('segmentClipPath cuts the active layer down to one segment', () => {
    const container = rect(100, 0, 300, 40);
    expect(segmentClipPath(container, rect(204, 4, 92, 32))).toBe('inset(0 104px 0 104px round 9999px)');
  });

  it('tabIndicatorTransform moves and scales a 1px bar under the tab', () => {
    expect(tabIndicatorTransform(rect(10, 0, 400, 40), rect(130, 0, 80, 40))).toBe('translateX(120px) scaleX(80)');
  });

  it('flipDirection follows the change', () => {
    expect(flipDirection(3, 4)).toBe('up');
    expect(flipDirection(4, 3)).toBe('down');
    expect(flipDirection(4, 4)).toBeNull();
  });

  it('exits run a quarter faster', () => expect(exitMs(200)).toBe(150));

  it('prefersReducedMotion is false during SSR', () => {
    expect(typeof window).toBe('undefined');
    expect(prefersReducedMotion()).toBe(false);
  });
});
