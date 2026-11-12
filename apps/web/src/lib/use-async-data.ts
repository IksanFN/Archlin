import { useCallback, useEffect, useState } from 'react';

export type AsyncData<T> = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: T };

// Loads on mount and again on reload(). Failures become a state the screen can show, never a thrown render error,
// so one broken list does not take the whole page down.
export function useAsyncData<T>(load: () => Promise<T>): { state: AsyncData<T>; reload: () => void } {
  const [state, setState] = useState<AsyncData<T>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    load().then(
      (data) => {
        if (!cancelled) setState({ status: 'ready', data });
      },
      () => {
        if (!cancelled) setState({ status: 'error' });
      },
    );
    return () => {
      cancelled = true;
    };
    // `attempt` is the retry trigger; `load` is stable per call site.
  }, [load, attempt]);

  const reload = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((current) => current + 1);
  }, []);

  return { state, reload };
}
