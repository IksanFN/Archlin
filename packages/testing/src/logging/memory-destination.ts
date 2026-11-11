export interface MemoryDestination {
  write(chunk: string): void;
  lines(): string[];
  text(): string;
  clear(): void;
}

// A pino-compatible destination that keeps log lines in memory, so tests can assert on exactly what would be written.
export function createMemoryDestination(): MemoryDestination {
  let buffer = '';
  return {
    write(chunk) {
      buffer += chunk;
    },
    lines: () => buffer.split('\n').filter((line) => line.length > 0),
    text: () => buffer,
    clear() {
      buffer = '';
    },
  };
}
