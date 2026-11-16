export class FileTooLargeError extends Error {
  override readonly name = 'FileTooLargeError';
  readonly code = 'file_too_large';

  constructor() {
    super('The file is larger than the allowed size');
  }
}

export class FileMissingError extends Error {
  override readonly name = 'FileMissingError';
  readonly code = 'blob_missing';

  constructor() {
    super('The stored file is missing');
  }
}

// Disk full, quota, read-only or permission problems: the caller can retry later, nothing is wrong with the request.
export class StorageUnavailableError extends Error {
  override readonly name = 'StorageUnavailableError';
  readonly code = 'storage_unavailable';

  constructor(cause: unknown) {
    super('File storage is unavailable', { cause });
  }
}
