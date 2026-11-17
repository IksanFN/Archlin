import { createHash, randomUUID } from 'node:crypto';
import type { Clock } from '@archlin/kernel';
import { assertStorageKey, FileMissingError, FileTooLargeError, HEAD_BYTES, normalizeStoragePrefix } from '@archlin/platform/server';
import type { FileStorage } from '@archlin/platform/server';

interface Entry {
  bytes: Uint8Array;
  modifiedAt: Date;
}

// Mirrors the disk adapter: same key rules, same publish-once behaviour, modification times from the injected clock.
export function createInMemoryStorage(clock: Clock): FileStorage {
  const files = new Map<string, Entry>();
  const staging = new Map<string, Entry>();

  return {
    async stage(body, { maxBytes }) {
      const reader = body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maxBytes) throw new FileTooLargeError();
          chunks.push(value);
        }
      } catch (err) {
        await reader.cancel().catch(() => undefined);
        throw err;
      }
      const bytes = Buffer.concat(chunks);
      const id = randomUUID();
      staging.set(id, { bytes, modifiedAt: clock.now() });
      return { id, size, sha256: createHash('sha256').update(bytes).digest('hex'), head: new Uint8Array(bytes.subarray(0, HEAD_BYTES)) };
    },

    async publish(staged, key) {
      assertStorageKey(key);
      const entry = staging.get(staged.id);
      if (!entry) throw new FileMissingError();
      staging.delete(staged.id);
      if (!files.has(key)) files.set(key, { bytes: entry.bytes, modifiedAt: clock.now() });
    },

    async exists(key) {
      assertStorageKey(key);
      return files.has(key);
    },

    async read(key) {
      assertStorageKey(key);
      const entry = files.get(key);
      if (!entry) throw new FileMissingError();
      return new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(entry.bytes));
          controller.close();
        },
      });
    },

    async delete(key) {
      assertStorageKey(key);
      files.delete(key);
    },

    async discard(staged) {
      staging.delete(staged.id);
    },

    async *list(prefix) {
      const directory = `${normalizeStoragePrefix(prefix)}/`;
      for (const [key, entry] of [...files]) {
        if (key.startsWith(directory)) yield { key, modifiedAt: new Date(entry.modifiedAt) };
      }
    },

    async sweepStaging(olderThan) {
      let removed = 0;
      for (const [id, entry] of [...staging]) {
        if (entry.modifiedAt < olderThan) {
          staging.delete(id);
          removed += 1;
        }
      }
      return removed;
    },
  };
}
