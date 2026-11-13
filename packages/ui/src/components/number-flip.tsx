import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { exitMs, flipDirection, MOTION_MS, prefersReducedMotion } from '../lib/motion';
import { cn } from '../lib/utils';

interface NumberFlipProps {
  value: number;
  className?: string;
}

function NumberFlip({ value, className }: NumberFlipProps) {
  const previous = useRef(value);
  const [outgoing, setOutgoing] = useState<number | null>(null);
  const [incoming, setIncoming] = useState(value);
  const [shifted, setShifted] = useState(false);
  const direction = outgoing === null ? null : flipDirection(outgoing, incoming);
  const reduce = prefersReducedMotion();

  useEffect(() => {
    if (value === previous.current) return;
    const from = previous.current;
    previous.current = value;
    setOutgoing(from);
    setIncoming(value);
    setShifted(false);
    const timeout = window.setTimeout(() => setOutgoing(null), reduce ? 0 : exitMs(MOTION_MS.base));
    return () => window.clearTimeout(timeout);
  }, [value, reduce]);

  useLayoutEffect(() => {
    if (outgoing === null) return;
    const frame = requestAnimationFrame(() => setShifted(true));
    return () => cancelAnimationFrame(frame);
  }, [outgoing, incoming]);

  const exitY = direction === 'down' ? '40%' : '-40%';
  const enterY = direction === 'down' ? '-40%' : '40%';

  return (
    <span data-slot="number-flip" className={cn('relative inline-flex overflow-hidden tabular-nums', className)}>
      <span className={outgoing === null ? undefined : 'invisible'}>{incoming}</span>
      {outgoing === null || direction === null ? null : (
        <>
          <span
            className="absolute inset-0 transition-[opacity,transform] duration-[150ms] ease-in motion-reduce:transform-none"
            style={
              shifted
                ? { opacity: 0, transform: reduce ? 'none' : `translateY(${exitY})` }
                : { opacity: 1, transform: 'none' }
            }
          >
            {outgoing}
          </span>
          <span
            className="absolute inset-0 transition-[opacity,transform] duration-200 ease-out motion-reduce:transform-none"
            style={
              {
                opacity: shifted ? 1 : 0,
                transform: reduce ? 'none' : shifted ? 'none' : `translateY(${enterY})`,
              } satisfies CSSProperties
            }
          >
            {incoming}
          </span>
        </>
      )}
    </span>
  );
}

export { NumberFlip };
