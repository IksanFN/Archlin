import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readdir, rename, stat, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { STAGING_PREFIX } from '../../contracts';
import { FileMissingError, FileTooLargeError, StorageUnavailableError } from './errors';
import { HEAD_BYTES } from './file-storage';
import type { FileStorage, StagedFile, StoredFile } from './file-storage';
import { assertStorageKey, isPlainSegment, normalizeStoragePrefix } from './storage-key';

const UNAVAILABLE_CODES = new Set(['ENOSPC', 'EDQUOT', 'EROFS', 'EACCES']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const codeOf = (err: unknown): string | undefined => (err as NodeJS.ErrnoException | null)?.code;
const isAbsent = (err: unknown): boolean => ['ENOENT', 'ENOTDIR', 'EISDIR'].includes(codeOf(err) ?? '');

function translate(err: unknown): unknown {
  return UNAVAILABLE_CODES.has(codeOf(err) ?? '') ? new StorageUnavailableError(err) : err;
}

async function io<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    throw translate(err);
  }
}

// Cleanup after a failure must never replace the error that caused it.
async function quietly(work: Promise<unknown>): Promise<void> {
  await work.catch(() => undefined);
}

// A single write can be partial, so keep going until the whole chunk is on disk.
async function writeAll(handle: FileHandle, bytes: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await handle.write(bytes, offset, bytes.byteLength - offset);
    offset += bytesWritten;
  }
}

async function removeIfPresent(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (err) {
    if (!isAbsent(err)) throw translate(err);
  }
}

export function createLocalDiskStorage(root: string): FileStorage {
  const stagingDir = join(root, STAGING_PREFIX);
  const pathOf = (key: string): string => {
    assertStorageKey(key);
    return join(root, ...key.split('/'));
  };
  const stagedPathOf = (staged: StagedFile): string => {
    if (!UUID_PATTERN.test(staged.id)) throw new Error('Invalid staged file id');
    return join(stagingDir, staged.id);
  };

  async function* walk(directory: string, keyDirectory: string): AsyncGenerator<StoredFile> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (err) {
      if (isAbsent(err)) return;
      throw translate(err);
    }
    for (const entry of entries) {
      if (!isPlainSegment(entry.name)) continue;
      const key = `${keyDirectory}/${entry.name}`;
      if (entry.isDirectory()) {
        yield* walk(join(directory, entry.name), key);
      } else if (entry.isFile()) {
        try {
          yield { key, modifiedAt: (await stat(join(directory, entry.name))).mtime };
        } catch (err) {
          // A file deleted between the listing and the stat simply is not listed.
          if (!isAbsent(err)) throw translate(err);
        }
      }
    }
  }

  async function exists(key: string): Promise<boolean> {
    const path = pathOf(key);
    try {
      return (await stat(path)).isFile();
    } catch (err) {
      if (isAbsent(err)) return false;
      throw translate(err);
    }
  }

  return {
    async stage(body, { maxBytes }) {
      await io(() => mkdir(stagingDir, { recursive: true }));
      const id = randomUUID();
      const path = join(stagingDir, id);
      const handle = await io(() => open(path, 'wx'));
      const reader = body.getReader();
      const hash = createHash('sha256');
      const head = new Uint8Array(HEAD_BYTES);
      let headLength = 0;
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maxBytes) throw new FileTooLargeError();
          hash.update(value);
          if (headLength < HEAD_BYTES) {
            const take = Math.min(HEAD_BYTES - headLength, value.byteLength);
            head.set(value.subarray(0, take), headLength);
            headLength += take;
          }
          await writeAll(handle, value);
        }
        await handle.sync();
        await handle.close();
      } catch (err) {
        await quietly(reader.cancel());
        await quietly(handle.close());
        await quietly(unlink(path));
        throw translate(err);
      }
      return { id, size, sha256: hash.digest('hex'), head: head.slice(0, headLength) };
    },

    async publish(staged, key) {
      const target = pathOf(key);
      const source = stagedPathOf(staged);
      await io(() => mkdir(dirname(target), { recursive: true }));
      if (await exists(key)) {
        await removeIfPresent(source);
        return;
      }
      try {
        await rename(source, target);
      } catch (err) {
        if (codeOf(err) === 'ENOENT') throw new FileMissingError();
        throw translate(err);
      }
    },

    exists,

    async read(key) {
      const path = pathOf(key);
      let handle: FileHandle;
      try {
        handle = await open(path, 'r');
      } catch (err) {
        if (isAbsent(err)) throw new FileMissingError();
        throw translate(err);
      }
      return Readable.toWeb(handle.createReadStream()) as ReadableStream<Uint8Array>;
    },

    async delete(key) {
      await removeIfPresent(pathOf(key));
    },

    async discard(staged) {
      await removeIfPresent(stagedPathOf(staged));
    },

    async *list(prefix) {
      const directory = normalizeStoragePrefix(prefix);
      yield* walk(join(root, ...directory.split('/')), directory);
    },

    async sweepStaging(olderThan) {
      let names: string[];
      try {
        names = await readdir(stagingDir);
      } catch (err) {
        if (isAbsent(err)) return 0;
        throw translate(err);
      }
      let removed = 0;
      for (const name of names) {
        const path = join(stagingDir, name);
        try {
          if ((await stat(path)).mtime < olderThan) {
            await unlink(path);
            removed += 1;
          }
        } catch (err) {
          if (!isAbsent(err)) throw translate(err);
        }
      }
      return removed;
    },
  };
}
