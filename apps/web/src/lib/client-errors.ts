import { AppError } from '../server/errors';
import { messages } from '../i18n/id';

export type ErrorPresentation =
  | { kind: 'field'; fields: Record<string, string> }
  | { kind: 'toast'; text: string }
  | { kind: 'redirect_login' };

interface FieldIssue {
  path: string;
  message: string;
}

function readIssues(details: unknown): FieldIssue[] {
  if (typeof details !== 'object' || details === null || !('issues' in details) || !Array.isArray(details.issues)) return [];
  return details.issues.filter(
    (issue): issue is FieldIssue =>
      typeof issue === 'object' && issue !== null && typeof issue.path === 'string' && typeof issue.message === 'string',
  );
}

function retryMinutes(details: unknown): number | null {
  if (typeof details !== 'object' || details === null || !('retryAfterSeconds' in details)) return null;
  const seconds = details.retryAfterSeconds;
  return typeof seconds === 'number' && seconds > 0 ? Math.ceil(seconds / 60) : null;
}

// Decides how a failed server function is shown. Screens that expect a specific code (wrong password, wrong TOTP code)
// read error.code first: those 401s are answers to the user, not a lost session.
export function messageForError(error: unknown): ErrorPresentation {
  if (!(error instanceof AppError)) return { kind: 'toast', text: messages.errors.offline };
  if (error.status === 401 && error.code === 'unauthenticated') return { kind: 'redirect_login' };
  if (error.status === 422) {
    const fields: Record<string, string> = {};
    for (const { path, message } of readIssues(error.details)) fields[path] ??= message;
    if (Object.keys(fields).length > 0) return { kind: 'field', fields };
  }
  if (error.status === 429) {
    const minutes = retryMinutes(error.details);
    if (minutes !== null) return { kind: 'toast', text: messages.errors.tooManyAttempts(minutes) };
  }
  if (error.status >= 500) return { kind: 'toast', text: messages.errors.internal(error.requestId) };
  return { kind: 'toast', text: error.message };
}
