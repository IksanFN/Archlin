import { ValidationError } from '@archlin/kernel';
import type { JSONContent } from '@tiptap/core';
import { Node as ProseMirrorNode, type Schema } from '@tiptap/pm/model';
import { CALLOUT_VARIANTS, getDocumentSchema, isAllowedImageSrc, isAllowedLink } from '../shared/document-schema';

function invalidDocument(): never {
  throw new ValidationError('invalid_document', 'Isi halaman tidak valid', {
    issues: [{ path: 'content', message: 'invalid_document' }],
  });
}

function unsafeUrl(): never {
  throw new ValidationError('unsafe_url', 'URL tidak aman', {
    issues: [{ path: 'content', message: 'unsafe_url' }],
  });
}

// fromJSON drops unknown attrs; reject them on the original JSON so they cannot round-trip.
function rejectUnknownAttrs(json: unknown, schema: Schema): void {
  if (typeof json !== 'object' || json === null) return;
  const record = json as Record<string, unknown>;
  if (typeof record.type === 'string' && record.attrs !== null && typeof record.attrs === 'object' && !Array.isArray(record.attrs)) {
    const type = schema.nodes[record.type] ?? schema.marks[record.type];
    if (type) {
      const allowed = type.spec.attrs ?? {};
      for (const key of Object.keys(record.attrs)) {
        if (!(key in allowed)) invalidDocument();
      }
    }
  }
  if (Array.isArray(record.content)) {
    for (const child of record.content) rejectUnknownAttrs(child, schema);
  }
  if (Array.isArray(record.marks)) {
    for (const mark of record.marks) rejectUnknownAttrs(mark, schema);
  }
}

export function parseDocument(json: unknown): ProseMirrorNode {
  const schema = getDocumentSchema();
  let node: ProseMirrorNode;
  try {
    node = ProseMirrorNode.fromJSON(schema, json);
    node.check();
  } catch {
    invalidDocument();
  }
  // fromJSON accepts any node type, but only a doc root is a page body.
  if (node.type !== schema.topNodeType) invalidDocument();
  rejectUnknownAttrs(json, schema);

  node.descendants((child) => {
    if (child.type.name === 'image') {
      if (typeof child.attrs.src !== 'string' || !isAllowedImageSrc(child.attrs.src)) unsafeUrl();
    }
    if (child.type.name === 'callout' && !(CALLOUT_VARIANTS as readonly string[]).includes(child.attrs.variant as string)) {
      invalidDocument();
    }
    for (const mark of child.marks) {
      if (mark.type.name !== 'link') continue;
      if (typeof mark.attrs.href !== 'string' || !isAllowedLink(mark.attrs.href)) unsafeUrl();
    }
  });

  return node;
}

// The only shape that is stored and hashed: unknown keys are gone and key order is the schema's.
export function normalizeDocument(json: unknown): JSONContent {
  return parseDocument(json).toJSON() as JSONContent;
}

export function documentText(doc: ProseMirrorNode): string {
  return doc.textBetween(0, doc.content.size, '\n', '\n');
}
