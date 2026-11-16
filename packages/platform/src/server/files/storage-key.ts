import { STAGING_PREFIX } from '../../contracts';

const KEY_PATTERN = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;

// A key reaches the disk as a path, so anything that could leave the root or reach staging is a bug in the caller.
export function assertStorageKey(key: string): void {
  const segments = key.split('/');
  const plain = KEY_PATTERN.test(key) && segments.every((segment) => segment !== '.' && segment !== '..');
  if (!plain || segments[0] === STAGING_PREFIX) throw new Error('Invalid storage key');
}

// A listing prefix names a directory, with or without its trailing slash. Returned without the slash.
export function normalizeStoragePrefix(prefix: string): string {
  const directory = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  assertStorageKey(directory);
  return directory;
}

export function isPlainSegment(name: string): boolean {
  return KEY_PATTERN.test(name) && name !== '.' && name !== '..';
}
