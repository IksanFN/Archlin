// Sidebar tree and the open route do not share a store; mutations ping this list.
const listeners = new Set<() => void>();

export function subscribeTreeMutation(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyTreeMutation(): void {
  for (const listener of listeners) listener();
}

// The open page reloads only when its own row changed elsewhere, so this signal carries the entity id.
const pageListeners = new Set<(entityId: string) => void>();

export function subscribePageChanged(listener: (entityId: string) => void): () => void {
  pageListeners.add(listener);
  return () => {
    pageListeners.delete(listener);
  };
}

export function notifyPageChanged(entityId: string): void {
  for (const listener of pageListeners) listener(entityId);
}
