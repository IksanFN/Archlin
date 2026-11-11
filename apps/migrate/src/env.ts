import { z } from 'zod';

const envSchema = z.strictObject({
  MIGRATOR_DATABASE_URL: z.url(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type MigrateEnv = z.infer<typeof envSchema>;

// Only the two known keys are copied out of the (possibly large) environment, so strictObject validates exactly
// those and unrelated variables cannot cause a failure. Errors name variables, never values: the url holds a password.
export function loadMigrateEnv(source: Readonly<Record<string, string | undefined>> = process.env): MigrateEnv {
  const result = envSchema.safeParse({
    MIGRATOR_DATABASE_URL: source.MIGRATOR_DATABASE_URL,
    LOG_LEVEL: source.LOG_LEVEL,
  });
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))];
    throw new Error(`Invalid migrate environment: ${names.join(', ')}`);
  }
  return result.data;
}
