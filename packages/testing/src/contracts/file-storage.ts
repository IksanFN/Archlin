import { createHash } from 'node:crypto';
import type { FileStorage } from '@archlin/platform/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const streamOf = (text: string): ReadableStream<Uint8Array> => {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
};

const textOf = async (stream: ReadableStream<Uint8Array>): Promise<string> => {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
};

const sha256Hex = (text: string): string => createHash('sha256').update(text).digest('hex');

// One suite for every FileStorage adapter, so the in-memory fake cannot drift from the disk behaviour.
export function fileStorageContract(
  name: string,
  make: () => Promise<{ storage: FileStorage; cleanup(): Promise<void> }>,
): void {
  describe(`FileStorage contract: ${name}`, () => {
    let storage: FileStorage;
    let cleanup: () => Promise<void>;

    beforeEach(async () => {
      ({ storage, cleanup } = await make());
    });
    afterEach(async () => {
      await cleanup();
    });

    it('stage hashes and counts the body, publish makes it readable', async () => {
      const staged = await storage.stage(streamOf('halo dunia'), { maxBytes: 100 });
      expect([staged.size, staged.sha256]).toEqual([10, sha256Hex('halo dunia')]);
      await storage.publish(staged, 'blobs/o/ab/abc');
      expect(await textOf(await storage.read('blobs/o/ab/abc'))).toBe('halo dunia');
    });

    it('stage keeps the first 4100 bytes of the body as the head', async () => {
      const staged = await storage.stage(streamOf('x'.repeat(5000)), { maxBytes: 10_000 });
      expect(staged.head.length).toBe(4100);
      const short = await storage.stage(streamOf('pendek'), { maxBytes: 100 });
      expect(new TextDecoder().decode(short.head)).toBe('pendek');
    });

    it('stage over maxBytes throws file_too_large and leaves no staging file', async () => {
      await expect(storage.stage(streamOf('x'.repeat(101)), { maxBytes: 100 })).rejects.toMatchObject({ code: 'file_too_large' });
      expect(await storage.sweepStaging(new Date(Date.now() + 60_000))).toBe(0);
    });

    it('publishing to an existing key keeps the first file and discards the staged one', async () => {
      await storage.publish(await storage.stage(streamOf('pertama'), { maxBytes: 100 }), 'blobs/o/aa/k');
      await storage.publish(await storage.stage(streamOf('kedua'), { maxBytes: 100 }), 'blobs/o/aa/k');
      expect(await textOf(await storage.read('blobs/o/aa/k'))).toBe('pertama');
      expect(await storage.sweepStaging(new Date(Date.now() + 60_000))).toBe(0);
    });

    it('exists reflects publish and delete', async () => {
      expect(await storage.exists('blobs/o/aa/k')).toBe(false);
      await storage.publish(await storage.stage(streamOf('isi'), { maxBytes: 100 }), 'blobs/o/aa/k');
      expect(await storage.exists('blobs/o/aa/k')).toBe(true);
      await storage.delete('blobs/o/aa/k');
      expect(await storage.exists('blobs/o/aa/k')).toBe(false);
    });

    it('read of a missing key throws blob_missing and delete of a missing key is fine', async () => {
      await expect(storage.read('blobs/o/aa/tidak-ada')).rejects.toMatchObject({ code: 'blob_missing' });
      await expect(storage.delete('blobs/o/aa/tidak-ada')).resolves.toBeUndefined();
    });

    it('discard removes a staged file and tolerates a second call', async () => {
      const staged = await storage.stage(streamOf('batal'), { maxBytes: 100 });
      await storage.discard(staged);
      await expect(storage.discard(staged)).resolves.toBeUndefined();
      expect(await storage.sweepStaging(new Date(Date.now() + 60_000))).toBe(0);
    });

    it('list returns published keys under a prefix with their modification time', async () => {
      for (const key of ['blobs/o/aa/1', 'blobs/o/bb/2', 'blobs/p/aa/3']) {
        await storage.publish(await storage.stage(streamOf(key), { maxBytes: 100 }), key);
      }
      const listed = [];
      for await (const file of storage.list('blobs/o/')) listed.push(file);
      expect(listed.map((f) => f.key).sort()).toEqual(['blobs/o/aa/1', 'blobs/o/bb/2']);
      expect(listed.every((f) => f.modifiedAt instanceof Date)).toBe(true);
    });

    it('list of a prefix that holds nothing yields nothing', async () => {
      const listed = [];
      for await (const file of storage.list('blobs/kosong/')) listed.push(file);
      expect(listed).toEqual([]);
    });

    it('sweepStaging removes staging files older than the cutoff only', async () => {
      await storage.stage(streamOf('tertinggal'), { maxBytes: 100 });
      expect(await storage.sweepStaging(new Date(Date.now() - 60_000))).toBe(0);
      expect(await storage.sweepStaging(new Date(Date.now() + 60_000))).toBe(1);
    });

    it.each(['blobs/../../etc/passwd', '../x', '/abs/path', 'blobs//x', 'blobs/a b', '', '.staging/x', 'blobs/./x'])(
      'a key that is not a plain relative path is rejected: %j',
      async (key) => {
        await expect(storage.exists(key)).rejects.toThrow();
        await expect(storage.read(key)).rejects.toThrow();
        await expect(storage.delete(key)).rejects.toThrow();
      },
    );
  });
}
