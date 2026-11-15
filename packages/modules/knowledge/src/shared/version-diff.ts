import DiffMatchPatch from 'diff-match-patch';
import { canonicalJson } from './canonical-json';
import type { ContextFields } from './inputs';

export interface VersionSnapshot {
  title: string;
  contentText: string;
  context: ContextFields;
  properties: Record<string, unknown>;
  noteTypeName: string | null;
}

export type DiffLine = { kind: 'same' | 'added' | 'removed'; text: string } | { kind: 'skipped'; count: number };

export type FieldKey = 'title' | 'noteType' | 'summary' | 'whenToUse' | 'source' | 'aliases' | `property:${string}`;

export interface FieldChange {
  field: FieldKey;
  before: string;
  after: string;
}

export interface VersionDiff {
  added: number;
  removed: number;
  fields: FieldChange[];
  lines: DiffLine[];
}

type TextLine = Exclude<DiffLine, { kind: 'skipped' }>;

export function formatPropertyValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(formatPropertyValue).join(', ');
  return canonicalJson(value);
}

// Every line ends in a newline, so a last line without one is not reported as changed when text follows it.
function withTrailingNewline(text: string): string {
  return text === '' || text.endsWith('\n') ? text : `${text}\n`;
}

function diffLines(before: string, after: string): TextLine[] {
  const dmp = new DiffMatchPatch();
  const { chars1, chars2, lineArray } = dmp.diff_linesToChars_(withTrailingNewline(before), withTrailingNewline(after));
  const diffs = dmp.diff_main(chars1, chars2, false);
  dmp.diff_charsToLines_(diffs, lineArray);
  const lines: TextLine[] = [];
  for (const [operation, text] of diffs) {
    const kind = operation === DiffMatchPatch.DIFF_INSERT ? 'added' : operation === DiffMatchPatch.DIFF_DELETE ? 'removed' : 'same';
    const parts = text.split('\n');
    parts.pop();
    for (const part of parts) lines.push({ kind, text: part });
  }
  return lines;
}

// Keeps `context` lines beside every change and folds the rest of a long unchanged run into one skipped row.
function collapse(lines: readonly TextLine[], context: number): DiffLine[] {
  if (lines.every((line) => line.kind === 'same')) return [...lines];
  const result: DiffLine[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line === undefined) break;
    if (line.kind !== 'same') {
      result.push(line);
      index += 1;
      continue;
    }
    let end = index;
    while (lines[end]?.kind === 'same') end += 1;
    const run = lines.slice(index, end) as TextLine[];
    const leading = index === 0;
    const trailing = end === lines.length;
    const keepBefore = leading ? 0 : context;
    const keepAfter = trailing ? 0 : context;
    if (run.length > keepBefore + keepAfter) {
      result.push(...run.slice(0, keepBefore));
      result.push({ kind: 'skipped', count: run.length - keepBefore - keepAfter });
      result.push(...run.slice(run.length - keepAfter));
    } else {
      result.push(...run);
    }
    index = end;
  }
  return result;
}

function fieldChanges(before: VersionSnapshot, after: VersionSnapshot): FieldChange[] {
  const pairs: [FieldKey, string, string][] = [
    ['title', before.title, after.title],
    ['noteType', before.noteTypeName ?? '', after.noteTypeName ?? ''],
    ['summary', before.context.summary ?? '', after.context.summary ?? ''],
    ['whenToUse', before.context.whenToUse ?? '', after.context.whenToUse ?? ''],
    ['source', before.context.source ?? '', after.context.source ?? ''],
    ['aliases', before.context.aliases.join(', '), after.context.aliases.join(', ')],
  ];
  const keys = [...new Set([...Object.keys(before.properties), ...Object.keys(after.properties)])].sort();
  for (const key of keys) {
    pairs.push([`property:${key}`, formatPropertyValue(before.properties[key]), formatPropertyValue(after.properties[key])]);
  }
  return pairs.filter(([, left, right]) => left !== right).map(([field, left, right]) => ({ field, before: left, after: right }));
}

export function diffVersions(before: VersionSnapshot, after: VersionSnapshot, context = 3): VersionDiff {
  const lines = diffLines(before.contentText, after.contentText);
  return {
    added: lines.filter((line) => line.kind === 'added').length,
    removed: lines.filter((line) => line.kind === 'removed').length,
    fields: fieldChanges(before, after),
    lines: collapse(lines, context),
  };
}
