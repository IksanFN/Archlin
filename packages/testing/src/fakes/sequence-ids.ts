import type { Ids } from '@archlin/kernel';

// Deterministic ids that are still valid uuids (version 7, variant 8), so they fit `uuid` columns.
export class SequenceIds implements Ids {
  #counter = 0;

  uuidv7(): string {
    this.#counter += 1;
    return `00000000-0000-7000-8000-${this.#counter.toString(16).padStart(12, '0')}`;
  }
}
