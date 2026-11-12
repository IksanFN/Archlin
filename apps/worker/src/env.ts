import { z } from 'zod';

export type WorkerConfigErrorCode = 'invalid_env' | 'migrator_secret_present';

export class WorkerConfigError extends Error {
  override readonly name = 'WorkerConfigError';
  readonly code: WorkerConfigErrorCode;

  constructor(code: WorkerConfigErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface WorkerEnv {
  databaseUrl: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

const isPostgresUrl = (value: string): boolean => {
  try {
    return ['postgres:', 'postgresql:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
};

const envSchema = z.strictObject({
  DATABASE_URL: z.string().refine(isPostgresUrl),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

// The worker runs as cortex_app. A migrator credential in its environment would defeat the split between the
// process that changes the schema and the ones that only use it (R04), so its mere presence stops the start.
export function loadWorkerEnv(source: Readonly<Record<string, string | undefined>> = process.env): WorkerEnv {
  if (source.MIGRATOR_DATABASE_URL !== undefined) {
    throw new WorkerConfigError('migrator_secret_present', 'MIGRATOR_DATABASE_URL must not be set for the worker process');
  }
  const result = envSchema.safeParse({ DATABASE_URL: source.DATABASE_URL, LOG_LEVEL: source.LOG_LEVEL });
  if (!result.success) {
    // Names only: the database url carries a password.
    const names = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))];
    throw new WorkerConfigError('invalid_env', `Invalid worker environment: ${names.join(', ')}`);
  }
  return { databaseUrl: result.data.DATABASE_URL, logLevel: result.data.LOG_LEVEL };
}
