import type { Logger } from '@archlin/kernel';
import { pino } from 'pino';
import { serializeError } from './serializers';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface CreateLoggerOptions {
  readonly level: LogLevel;
  readonly service: string;
  readonly destination?: { write(chunk: string): void };
}

// Wildcard paths match exactly one level in pino's redaction engine (fast-redact).
export const REDACTED_PATHS: readonly string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.newPassword',
  '*.currentPassword',
  '*.token',
  '*.sessionToken',
  '*.challengeToken',
  '*.totp',
  '*.code',
  '*.recoveryCode',
  '*.setupToken',
];

// `*.key` alone misses a credential logged at the top level (`log.info({ password })`) and one nested a level
// deeper, so the wildcard keys are also matched at depth one and three.
const redactPaths = (): string[] => {
  const keys = REDACTED_PATHS.filter((path) => path.startsWith('*.')).map((path) => path.slice(2));
  return [...REDACTED_PATHS, ...keys, ...keys.map((key) => `*.*.${key}`)];
};

// `*.code` must stay in REDACTED_PATHS (TOTP input), and it would also censor `err.code`. Logged errors therefore
// expose their code as `errorCode`, which no redaction path matches.
function serializeErrorForLog(err: unknown): Record<string, string> {
  const { code, ...rest } = serializeError(err);
  return code === undefined ? rest : { ...rest, errorCode: code };
}

function wrap(base: pino.Logger): Logger {
  return {
    debug: (obj, msg) => base.debug(obj, msg),
    info: (obj, msg) => base.info(obj, msg),
    warn: (obj, msg) => base.warn(obj, msg),
    error: (obj, msg) => base.error(obj, msg),
    child: (bindings) => wrap(base.child(bindings)),
  };
}

// No transport: transports run in a worker thread, which the single-process bundles do not need.
export function createLogger({ level, service, destination }: CreateLoggerOptions): Logger {
  const options: pino.LoggerOptions = {
    level,
    base: { service },
    redact: { paths: redactPaths(), censor: '[Redacted]' },
    serializers: { err: serializeErrorForLog },
    timestamp: pino.stdTimeFunctions.isoTime,
  };
  return wrap(destination ? pino(options, destination) : pino(options));
}
