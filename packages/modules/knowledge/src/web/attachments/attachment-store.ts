import type { AttachmentView } from '@archlin/modules-knowledge/shared';

export interface AttachmentStore {
  get(id: string): AttachmentView | undefined;
  upsert(view: AttachmentView): void;
  replace(views: readonly AttachmentView[]): void;
  all(): AttachmentView[];
  subscribe(listener: () => void): () => void;
}

// Cards in the document hold only an attachment id; name, size and extraction status are read from here.
export function createAttachmentStore(initial: readonly AttachmentView[]): AttachmentStore {
  let entries = new Map(initial.map((view) => [view.id, view]));
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of listeners) listener();
  };
  return {
    get: (id) => entries.get(id),
    upsert(view) {
      entries = new Map(entries).set(view.id, view);
      notify();
    },
    replace(views) {
      entries = new Map(views.map((view) => [view.id, view]));
      notify();
    },
    all: () => [...entries.values()],
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
