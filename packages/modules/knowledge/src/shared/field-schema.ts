import { z } from 'zod';

export const FIELD_TYPES = ['text', 'longtext', 'date', 'select', 'url', 'number'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const PROPERTY_KEY = /^[a-z][a-z0-9_]{0,63}$/;

export interface FieldDefinition {
  key: string;
  label: string;
  type: FieldType;
  options?: string[];
  required?: boolean;
  searchWeight?: 'B' | 'C' | 'none';
  remind?: { daysBefore: number };
}

export interface PropertyIssue {
  path: string;
  message: 'invalid_property' | 'unknown_property';
}

const uniqueItems = (items: readonly string[]) => new Set(items).size === items.length;

export const fieldDefinitionSchema = z
  .strictObject({
    key: z.string().regex(PROPERTY_KEY),
    label: z.string().trim().min(1).max(60),
    type: z.enum(FIELD_TYPES),
    options: z.array(z.string().trim().min(1).max(60)).min(1).max(30).refine(uniqueItems).optional(),
    required: z.boolean().optional(),
    searchWeight: z.enum(['B', 'C', 'none']).optional(),
    remind: z.strictObject({ daysBefore: z.int().min(0).max(365) }).optional(),
  })
  .superRefine((field, ctx) => {
    if (field.type === 'select') {
      if (field.options === undefined) ctx.addIssue({ code: 'custom', path: ['options'] });
    } else if (field.options !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['options'] });
    }
    if (field.remind !== undefined && field.type !== 'date') {
      ctx.addIssue({ code: 'custom', path: ['remind'] });
    }
  });

export const fieldSchemaSchema = z
  .array(fieldDefinitionSchema)
  .max(30)
  .superRefine((fields, ctx) => {
    const seen = new Set<string>();
    for (let i = 0; i < fields.length; i += 1) {
      const key = fields[i]?.key;
      if (key === undefined) continue;
      if (seen.has(key)) {
        ctx.addIssue({ code: 'custom', path: [i, 'key'], message: 'duplicate_key' });
        continue;
      }
      seen.add(key);
    }
  });

export function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  return typeof value === 'string' && value.trim() === '';
}

function isCalendarDate(value: string): boolean {
  const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(value);
  if (match === null) return false;
  const yearText = match[1];
  const monthText = match[2];
  const dayText = match[3];
  if (yearText === undefined || monthText === undefined || dayText === undefined) return false;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isHttpUrl(value: string): boolean {
  if (value.length > 2000 || !URL.canParse(value)) return false;
  const protocol = new URL(value).protocol;
  return protocol === 'http:' || protocol === 'https:';
}

function matchesField(field: FieldDefinition, value: unknown): boolean {
  if (isEmptyValue(value)) return true;
  switch (field.type) {
    case 'text':
      return typeof value === 'string' && value.length <= 500;
    case 'longtext':
      return typeof value === 'string' && value.length <= 10_000;
    case 'date':
      return typeof value === 'string' && isCalendarDate(value);
    case 'select':
      return typeof value === 'string' && (field.options?.includes(value) ?? false);
    case 'url':
      return typeof value === 'string' && isHttpUrl(value);
    case 'number':
      return Number.isFinite(value);
  }
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((item, index) => deepEqual(item, right[index]));
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keys = Object.keys(leftRecord);
  if (keys.length !== Object.keys(rightRecord).length) return false;
  return keys.every((key) => Object.hasOwn(rightRecord, key) && deepEqual(leftRecord[key], rightRecord[key]));
}

function own(record: Readonly<Record<string, unknown>>, key: string): unknown {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

// Unchanged values, including keys the type no longer defines, stay valid so old pages can still be saved.
export function validateProperties(
  fields: readonly FieldDefinition[],
  next: Readonly<Record<string, unknown>>,
  previous: Readonly<Record<string, unknown>>,
): PropertyIssue[] {
  const defined = new Map(fields.map((item) => [item.key, item]));
  const issues: PropertyIssue[] = [];
  for (const key of Object.keys(next)) {
    const value = own(next, key);
    const field = defined.get(key);
    if (field === undefined) {
      if (!deepEqual(value, own(previous, key))) {
        issues.push({ path: `properties.${key}`, message: 'unknown_property' });
      }
      continue;
    }
    if (!matchesField(field, value) && !deepEqual(value, own(previous, key))) {
      issues.push({ path: `properties.${key}`, message: 'invalid_property' });
    }
  }
  return issues;
}

export function missingRequired(fields: readonly FieldDefinition[], props: Readonly<Record<string, unknown>>): string[] {
  return fields.filter((item) => item.required === true && isEmptyValue(own(props, item.key))).map((item) => item.key);
}

export function legacyKeys(fields: readonly FieldDefinition[], props: Readonly<Record<string, unknown>>): string[] {
  return fields.filter((item) => !matchesField(item, own(props, item.key))).map((item) => item.key);
}
