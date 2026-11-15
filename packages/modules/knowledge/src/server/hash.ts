import { createHash } from 'node:crypto';
import type { JSONContent } from '@tiptap/core';
import { canonicalJson } from '../shared/canonical-json';

interface PageContext {
  summary: string | null;
  whenToUse: string | null;
  source: string | null;
  aliases: string[];
}

export interface PageState {
  title: string;
  content: JSONContent;
  context: PageContext;
  properties: Record<string, unknown>;
  noteTypeId: string;
}

export function pageStateHash(state: PageState): string {
  return createHash('sha256').update(canonicalJson(state)).digest('hex');
}
