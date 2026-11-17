import { documentText, getDocumentSchema } from '@archlin/modules-knowledge/shared';
import type { FieldDefinition, FieldKey, PageView, SnapshotReason, VersionDetail, VersionSnapshot } from '@archlin/modules-knowledge/shared';
import { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { PageDraftState } from '../autosave/autosave-machine';
import type { HistoryLabels } from './labels';

export function reasonLabel(reason: SnapshotReason, labels: HistoryLabels): string {
  return labels.reasons[reason];
}

export function fieldLabel(field: FieldKey, fieldSchema: readonly FieldDefinition[], labels: HistoryLabels): string {
  if (!field.startsWith('property:')) return labels.fields[field as keyof HistoryLabels['fields']];
  const key = field.slice('property:'.length);
  return fieldSchema.find((definition) => definition.key === key)?.label ?? key;
}

// The "now" side of a diff is the open editor, which may be ahead of the saved page.
export function snapshotFromDraft(page: PageView, draft: PageDraftState): VersionSnapshot {
  const doc = ProseMirrorNode.fromJSON(getDocumentSchema(), draft.content);
  return {
    title: draft.title,
    contentText: documentText(doc),
    context: draft.context,
    properties: draft.properties,
    noteTypeName: page.noteType.name,
  };
}

export function snapshotFromDetail(detail: VersionDetail): VersionSnapshot {
  return {
    title: detail.title,
    contentText: detail.contentText,
    context: detail.context,
    properties: detail.properties,
    noteTypeName: detail.noteType.name,
  };
}
