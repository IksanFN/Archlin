import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileStorageContract } from '@archlin/testing/contracts';
import { expect, it } from 'vitest';
import { createLocalDiskStorage } from './local-disk-storage';

fileStorageContract('local disk', async () => {
  const root = await mkdtemp(join(tmpdir(), 'archlin-files-'));
  return { storage: createLocalDiskStorage(root), cleanup: () => rm(root, { recursive: true, force: true }) };
});

const streamOf = (text: string): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });

it('a key with a parent segment is rejected before touching the disk', async () => {
  const root = await mkdtemp(join(tmpdir(), 'archlin-files-'));
  try {
    const storage = createLocalDiskStorage(root);
    await expect(storage.exists('blobs/../../etc/passwd')).rejects.toThrow();
    expect(await readdir(root)).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('a published file sits under its blob key and staging is empty afterwards', async () => {
  const root = await mkdtemp(join(tmpdir(), 'archlin-files-'));
  try {
    const storage = createLocalDiskStorage(root);
    await storage.publish(await storage.stage(streamOf('isi'), { maxBytes: 100 }), 'blobs/o/ab/abc');
    expect(await readdir(join(root, 'blobs', 'o', 'ab'))).toEqual(['abc']);
    expect(await readdir(join(root, '.staging'))).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
