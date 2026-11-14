// Pages register their flush while mounted so sign-out can save them before the session ends.
const flushes = new Set<() => Promise<unknown>>();

export function registerAutosaveFlush(flush: () => Promise<unknown>): () => void {
  flushes.add(flush);
  return () => {
    flushes.delete(flush);
  };
}

// allSettled: one page that cannot save (conflict, offline) must not keep the others from saving.
export async function flushActiveAutosaves(): Promise<void> {
  await Promise.allSettled([...flushes].map((flush) => flush()));
}
