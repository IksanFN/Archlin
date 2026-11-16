import type { OutboundLink } from '@archlin/platform/contracts';

export interface LinkTargetStore {
  get(key: string): OutboundLink | undefined;
  set(link: OutboundLink): void;
  replace(links: readonly OutboundLink[]): void;
  subscribe(listener: () => void): () => void;
}

// The editor keeps link nodes as typed; titles, urls and trash state come from here so a rename shows without rewriting the document.
export function createLinkTargetStore(initial: readonly OutboundLink[]): LinkTargetStore {
  let entries = new Map(initial.map((link) => [link.key, link]));
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of listeners) listener();
  };
  return {
    get: (key) => entries.get(key),
    set(link) {
      entries = new Map(entries).set(link.key, link);
      notify();
    },
    replace(links) {
      entries = new Map(links.map((link) => [link.key, link]));
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
