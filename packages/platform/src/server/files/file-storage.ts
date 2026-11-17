export interface StagedFile {
  readonly id: string;
  readonly size: number;
  readonly sha256: string;
  // First 4,100 bytes: enough for fileTypeFromBuffer to sniff the type without reading the file again.
  readonly head: Uint8Array;
}

export interface StoredFile {
  readonly key: string;
  readonly modifiedAt: Date;
}

export interface FileStorage {
  // Streams the body into staging while hashing and counting it. Over maxBytes throws FileTooLargeError and leaves nothing.
  stage(body: ReadableStream<Uint8Array>, limits: { maxBytes: number }): Promise<StagedFile>;
  // Moves a staged file to its key. A key that already exists keeps its file and the staged one is discarded.
  publish(staged: StagedFile, key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  read(key: string): Promise<ReadableStream<Uint8Array>>;
  delete(key: string): Promise<void>;
  discard(staged: StagedFile): Promise<void>;
  list(prefix: string): AsyncIterable<StoredFile>;
  // Removes staging files last modified before the cutoff and returns how many went.
  sweepStaging(olderThan: Date): Promise<number>;
}

export const HEAD_BYTES = 4100;
