// Structural logger contract. Implementations (pino in platform) must never log note content,
// capture text, search queries or credentials (spec 13.4 K7); callers pass ids, lengths and error codes.
export interface Logger {
  debug(obj: object, msg?: string): void;
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
  child(bindings: Record<string, string | number>): Logger;
}
