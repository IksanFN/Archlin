import { canonicalJson } from '@archlin/modules-knowledge/shared';
import type { NoteTypeDetail, NoteTypeSummary, ReviewMode } from '@archlin/modules-knowledge/shared';
import { isSingleEmoji } from '@archlin/platform/contracts';
import { Button } from '@archlin/ui/components/button';
import { EmojiField } from '@archlin/ui/components/emoji-field';
import type { EmojiFieldLabels } from '@archlin/ui/components/emoji-field';
import { InlineStatus } from '@archlin/ui/components/inline-status';
import { Input } from '@archlin/ui/components/input';
import { SegmentedControl } from '@archlin/ui/components/segmented-control';
import { toast } from '@archlin/ui/components/sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@archlin/ui/components/tabs';
import { useLeaving } from '@archlin/ui/lib/use-leaving';
import { PlusIcon } from '@phosphor-icons/react/ssr';
import type { JSONContent } from '@tiptap/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { KnowledgeClientError, useKnowledgeClient } from '../client';
import type { EditorLabels } from '../editor/labels';
import { PageEditor } from '../editor/page-editor';
import { DeleteTypeDialog } from './delete-type-dialog';
import { FieldRow } from './field-row';
import { newFieldRow, relabelRow, rowProblems, rowsFromSchema, rowsToSchema, serverProblems } from './field-rows';
import type { FieldRowState, RowProblems } from './field-rows';
import type { NoteTypeLabels } from './labels';

type Issues = readonly { path: string; message: string }[];

function issuesOf(details: unknown): Issues {
  if (typeof details !== 'object' || details === null || !('issues' in details) || !Array.isArray(details.issues)) {
    return [];
  }
  return details.issues.filter(
    (issue): issue is { path: string; message: string } =>
      typeof issue === 'object' &&
      issue !== null &&
      typeof (issue as { path: unknown }).path === 'string' &&
      typeof (issue as { message: unknown }).message === 'string',
  );
}

export function NoteTypeEditor({
  detail,
  others,
  labels,
  editorLabels,
  iconLabels,
  onDirtyChange,
  onRefresh,
  onDeleted,
}: {
  detail: NoteTypeDetail;
  // Every other type, as targets for the pages of a type that is deleted.
  others: readonly NoteTypeSummary[];
  labels: NoteTypeLabels;
  editorLabels: EditorLabels;
  iconLabels: EmojiFieldLabels;
  onDirtyChange(dirty: boolean): void;
  // Loads the type again; the screen remounts this editor on the new revision.
  onRefresh(): Promise<void> | void;
  onDeleted(): void;
}) {
  const client = useKnowledgeClient();
  const copy = labels.editor;
  const leaving = useLeaving<string>();
  const baseline = useMemo(() => {
    const rows = rowsFromSchema(detail.fieldSchema);
    return { rows, schema: canonicalJson(rowsToSchema(rows)), keys: new Set(detail.fieldSchema.map((field) => field.key)) };
  }, [detail]);
  // The editor rebuilds its extensions whenever its labels change, so the template editor needs a stable object.
  const templateLabels = useMemo(() => ({ ...editorLabels, body: copy.templateLabel }), [editorLabels, copy.templateLabel]);
  const nextRowId = useRef(0);
  const [name, setName] = useState(detail.name);
  const [icon, setIcon] = useState(detail.icon);
  const [rows, setRows] = useState<FieldRowState[]>(baseline.rows);
  const [template, setTemplate] = useState<JSONContent>(detail.template);
  const [reviewMode, setReviewMode] = useState<ReviewMode>(detail.defaultReviewMode);
  const [epoch, setEpoch] = useState(0);
  const [addedId, setAddedId] = useState<string | null>(null);
  const [showProblems, setShowProblems] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [serverIssues, setServerIssues] = useState<Issues>([]);
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const dirty =
    name !== detail.name ||
    icon !== detail.icon ||
    reviewMode !== detail.defaultReviewMode ||
    canonicalJson(rowsToSchema(rows)) !== baseline.schema ||
    canonicalJson(template) !== canonicalJson(detail.template);

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  const fromServer = serverProblems(serverIssues, rows);
  const nameMissing = name.trim() === '';
  const clientProblems = rows.map(rowProblems);
  const hasProblems = nameMissing || clientProblems.some((problems) => Object.keys(problems).length > 0);

  function problemsOf(row: FieldRowState, index: number): RowProblems {
    return { ...(showProblems ? clientProblems[index] : undefined), ...fromServer.get(row.id) };
  }

  function takenFor(rowId: string): Set<string> {
    return new Set([...baseline.keys, ...rows.filter((row) => row.id !== rowId).map((row) => row.key)]);
  }

  function patchRow(id: string, patch: Partial<FieldRowState>): void {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function addRow(): void {
    nextRowId.current += 1;
    const id = `new:${nextRowId.current}`;
    setRows((current) => [...current, newFieldRow(id, new Set([...baseline.keys, ...current.map((row) => row.key)]))]);
    setAddedId(id);
  }

  function moveRow(index: number, direction: 'up' | 'down'): void {
    const target = direction === 'up' ? index - 1 : index + 1;
    setRows((current) => {
      const moved = current[index];
      const other = current[target];
      if (moved === undefined || other === undefined) return current;
      const next = [...current];
      next[index] = other;
      next[target] = moved;
      return next;
    });
  }

  async function removeRow(id: string): Promise<void> {
    await leaving.leave(id);
    setRows((current) => current.filter((row) => row.id !== id));
  }

  function discard(): void {
    setName(detail.name);
    setIcon(detail.icon);
    setRows(baseline.rows);
    setTemplate(detail.template);
    setReviewMode(detail.defaultReviewMode);
    setServerIssues([]);
    setShowProblems(false);
    setEpoch((count) => count + 1);
  }

  async function save(): Promise<void> {
    if (hasProblems) {
      setShowProblems(true);
      setAttempt((count) => count + 1);
      return;
    }
    setSaving(true);
    setServerIssues([]);
    try {
      await client.updateNoteType({
        id: detail.id,
        baseRevision: detail.revision,
        name: name.trim(),
        icon,
        fieldSchema: rowsToSchema(rows),
        template,
        defaultReviewMode: reviewMode,
      });
      toast(copy.saved);
      await onRefresh();
    } catch (error) {
      if (error instanceof KnowledgeClientError && error.code === 'note_type_conflict') {
        setConflict(true);
      } else if (error instanceof KnowledgeClientError && error.status === 422 && issuesOf(error.details).length > 0) {
        setServerIssues(issuesOf(error.details));
        setAttempt((count) => count + 1);
      } else {
        toast.error(copy.saveFailed);
      }
    } finally {
      setSaving(false);
    }
  }

  const reviewOptions: { value: ReviewMode; label: string }[] = [
    { value: 'none', label: copy.reviewNone },
    { value: 'daily', label: copy.reviewDaily },
    { value: 'spaced', label: copy.reviewSpaced },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start gap-2">
        <EmojiField value={icon} onChange={setIcon} isValid={isSingleEmoji} labels={iconLabels} />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Input
            size="lg"
            aria-label={copy.name}
            value={name}
            maxLength={60}
            onChange={(event) => setName(event.target.value)}
            {...(showProblems && nameMissing ? { 'aria-invalid': true as const } : {})}
          />
          {showProblems && nameMissing ? (
            <p role="alert" className="text-micro text-danger">
              {copy.nameRequired}
            </p>
          ) : null}
        </div>
      </div>
      <Tabs defaultValue="fields">
        <TabsList>
          <TabsTrigger value="fields">{copy.tabFields}</TabsTrigger>
          <TabsTrigger value="template">{copy.tabTemplate}</TabsTrigger>
        </TabsList>
        <TabsContent value="fields" className="pt-4">
          <ul className="flex flex-col">
            {rows.map((row, index) => (
              <FieldRow
                key={row.id}
                row={row}
                index={index}
                count={rows.length}
                problems={problemsOf(row, index)}
                invalidAttempt={attempt}
                leaving={leaving.isLeaving(row.id)}
                autoFocus={row.id === addedId}
                labels={labels}
                onLabelChange={(label) =>
                  setRows((current) =>
                    current.map((item) => (item.id === row.id ? relabelRow(item, label, takenFor(row.id)) : item)),
                  )
                }
                onChange={(patch) => patchRow(row.id, patch)}
                onMove={(direction) => moveRow(index, direction)}
                onDelete={() => void removeRow(row.id)}
              />
            ))}
          </ul>
          <Button variant="outline" className="mt-2" leadingIcon={<PlusIcon aria-hidden="true" size={16} />} onClick={addRow}>
            {copy.addField}
          </Button>
          <div className="mt-8 flex flex-col gap-2">
            <span className="text-small font-medium text-fg">{copy.reviewMode}</span>
            <SegmentedControl
              aria-label={copy.reviewMode}
              value={reviewMode}
              onValueChange={setReviewMode}
              options={reviewOptions}
            />
            <span className="text-micro text-fg-muted">{copy.reviewHelper}</span>
          </div>
        </TabsContent>
        <TabsContent value="template" className="pt-4">
          <PageEditor
            key={epoch}
            content={template}
            editable
            labels={templateLabels}
            onChange={setTemplate}
          />
        </TabsContent>
      </Tabs>
      <div className="border-t border-line-subtle pt-6">
        {detail.isSystem ? (
          <p className="text-small text-fg-muted">{copy.deleteSystem}</p>
        ) : (
          <Button variant="outline" className="text-danger" onClick={() => setDeleting(true)}>
            {copy.deleteType}
          </Button>
        )}
      </div>
      {conflict ? (
        <InlineStatus variant="attention">
          {copy.conflict}{' '}
          <Button variant="ghost" size="row" onClick={() => void onRefresh()}>
            {copy.reload}
          </Button>
        </InlineStatus>
      ) : null}
      {showProblems && hasProblems ? <InlineStatus variant="danger">{copy.invalid}</InlineStatus> : null}
      {dirty ? (
        <div className="enter-item sticky bottom-0 flex justify-end gap-3 border-t border-line-subtle bg-bg py-3">
          <Button variant="ghost" disabled={saving} onClick={discard}>
            {copy.discard}
          </Button>
          <Button loading={saving} disabled={conflict} onClick={() => void save()}>
            {copy.save}
          </Button>
        </div>
      ) : null}
      {detail.isSystem ? null : (
        <DeleteTypeDialog type={detail} others={others} open={deleting} onOpenChange={setDeleting} onDeleted={onDeleted} labels={labels} />
      )}
    </div>
  );
}
