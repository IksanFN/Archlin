export const MOTION_MS = { fast: 120, base: 200, slow: 320 } as const;

export function exitMs(enterMs: number): number {
  return Math.round(enterMs * 0.75);
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function segmentClipPath(container: DOMRectReadOnly, segment: DOMRectReadOnly): string {
  const right = container.right - segment.right;
  const left = segment.left - container.left;
  return `inset(0 ${right}px 0 ${left}px round 9999px)`;
}

export function tabIndicatorTransform(container: DOMRectReadOnly, tab: DOMRectReadOnly): string {
  return `translateX(${tab.left - container.left}px) scaleX(${tab.width})`;
}

export function flipDirection(previous: number, next: number): 'up' | 'down' | null {
  if (next > previous) return 'up';
  if (next < previous) return 'down';
  return null;
}
