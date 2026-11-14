import { deriveTypeKey } from '@archlin/modules-knowledge/shared';
import type { FieldDefinition, FieldType } from '@archlin/modules-knowledge/shared';

export type SearchWeight = 'B' | 'C' | 'none';

// One editable field. `persisted` rows came from the server and never get a new key, because pages store values by key.
export interface FieldRowState {
  id: string;
  key: string;
  persisted: boolean;
  label: string;
  type: FieldType;
  options: string[];
  required: boolean;
  searchWeight: SearchWeight;
  remindDays: number | null;
}

export function rowsFromSchema(fields: readonly FieldDefinition[]): FieldRowState[] {
  return fields.map((field) => ({
    id: `persisted:${field.key}`,
    key: field.key,
    persisted: true,
    label: field.label,
    type: field.type,
    options: field.options ?? [],
    required: field.required === true,
    searchWeight: field.searchWeight ?? 'C',
    remindDays: field.remind?.daysBefore ?? null,
  }));
}

export function rowsToSchema(rows: readonly FieldRowState[]): FieldDefinition[] {
  return rows.map((row) => {
    const field: FieldDefinition = { key: row.key, label: row.label, type: row.type, searchWeight: row.searchWeight };
    if (row.type === 'select') field.options = row.options;
    if (row.required) field.required = true;
    if (row.type === 'date' && row.remindDays !== null) field.remind = { daysBefore: row.remindDays };
    return field;
  });
}

export function keyForNewField(label: string, taken: ReadonlySet<string>): string {
  return deriveTypeKey(label, taken);
}

export function newFieldRow(id: string, taken: ReadonlySet<string>): FieldRowState {
  return {
    id,
    key: keyForNewField('', taken),
    persisted: false,
    label: '',
    type: 'text',
    options: [],
    required: false,
    searchWeight: 'C',
    remindDays: null,
  };
}

// `taken` holds every other key in the schema, including fields deleted in this edit, so a recreated field never reuses
// a key whose old values and type still sit on existing pages.
export function relabelRow(row: FieldRowState, label: string, taken: ReadonlySet<string>): FieldRowState {
  if (row.persisted) return { ...row, label };
  return { ...row, label, key: keyForNewField(label, taken) };
}

export interface RowProblems {
  label?: true;
  options?: true;
  remind?: true;
  type?: true;
}

// Mirrors what the server would reject, so the save bar can point at the row before a request is made.
export function rowProblems(row: FieldRowState): RowProblems {
  const problems: RowProblems = {};
  if (row.label.trim() === '') problems.label = true;
  if (row.type === 'select' && row.options.length === 0) problems.options = true;
  if (row.type === 'date' && row.remindDays !== null) {
    if (!Number.isInteger(row.remindDays) || row.remindDays < 0 || row.remindDays > 365) problems.remind = true;
  }
  return problems;
}

const SERVER_PATH = /^fieldSchema\.(\d+)\.(\w+)/;

// Server issues name a field by position and property, which the editor shows on the matching row.
export function serverProblems(
  issues: readonly { path: string; message: string }[],
  rows: readonly FieldRowState[],
): Map<string, RowProblems> {
  const found = new Map<string, RowProblems>();
  for (const issue of issues) {
    const match = SERVER_PATH.exec(issue.path);
    const row = match?.[1] === undefined ? undefined : rows[Number(match[1])];
    if (row === undefined) continue;
    const problems = found.get(row.id) ?? {};
    const property = match?.[2];
    if (property === 'options') problems.options = true;
    else if (property === 'remind') problems.remind = true;
    else if (property === 'type') problems.type = true;
    else problems.label = true;
    found.set(row.id, problems);
  }
  return found;
}

// An issue that names no row (an invalid template, say) has nowhere to show, so the save must still report a failure.
export function saveRejection(
  issues: readonly { path: string; message: string }[],
  rows: readonly FieldRowState[],
): { kind: 'rows' } | { kind: 'failure' } {
  return serverProblems(issues, rows).size > 0 ? { kind: 'rows' } : { kind: 'failure' };
}
