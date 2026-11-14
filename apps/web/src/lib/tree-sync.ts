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
