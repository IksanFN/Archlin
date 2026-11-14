import { legacyKeys, missingRequired } from '@archlin/modules-knowledge/shared';
import type { ContextFields, PageView } from '@archlin/modules-knowledge/shared';
import type { TagRef } from '@archlin/platform/contracts';
import { ChipInput } from '@archlin/ui/components/chip-input';
import { Collapsible, CollapsibleChevron, CollapsibleContent, CollapsibleTrigger } from '@archlin/ui/components/collapsible';
import { FormField } from '@archlin/ui/components/form-field';
import { Input } from '@archlin/ui/components/input';
import { toast } from '@archlin/ui/components/sonner';
import { Textarea } from '@archlin/ui/components/textarea';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { PageDraftState } from '../autosave/autosave-machine';
import { browserStorage } from '../autosave/draft-store';
import { useKnowledgeClient } from '../client';
import { ContextNudge, type ContextNudgeLabels } from './context-nudge';
import { ROW_LAYOUT, TypeField, type TypeFieldLabels } from './type-field';

const COLLAPSED_KEY = 'archlin.contextCard.collapsed';
const SUGGEST_DEBOUNCE_MS = 150;
const SUMMARY_COUNTER_FROM = 900;
const MAX_ALIASES = 20;
const MAX_TAGS = 20;

export interface ContextCardLabels extends TypeFieldLabels {
  title: string;
  empty: string;
  summary: string;
  whenToUse: string;
  source: string;
  aliases: string;
  aliasesPlaceholder: string;
  aliasesLimit: string;
  removeAlias(value: string): string;
  tags: string;
  tagsPlaceholder: string;
  tagsLimit: string;
  tagsFailed: string;
  removeTag(value: string): string;
  counter(length: number): string;
  issue(message: string): string;
  nudge: ContextNudgeLabels;
}

type Issues = readonly { path: string; message: string }[];

function readStoredCollapsed(): boolean {
  try {
    return browserStorage()?.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

// Kept in memory as well, so the card still folds in a tab whose storage refuses writes.
let collapsedCache: boolean | null = null;
const collapsedListeners = new Set<() => void>();

function getCollapsed(): boolean {
  collapsedCache ??= readStoredCollapsed();
  return collapsedCache;
}

function setCollapsed(next: boolean): void {
  collapsedCache = next;
  try {
    const storage = browserStorage();
    if (next) storage?.setItem(COLLAPSED_KEY, '1');
    else storage?.removeItem(COLLAPSED_KEY);
  } catch {
    // The preference is per device; losing it only means the card opens expanded next time.
  }
  for (const listener of collapsedListeners) listener();
}

function subscribeCollapsed(onChange: () => void): () => void {
  collapsedListeners.add(onChange);
  const onStorage = (event: StorageEvent): void => {
    if (event.key !== COLLAPSED_KEY) return;
    collapsedCache = readStoredCollapsed();
    onChange();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    collapsedListeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

function legacyText(value: unknown): string {
  const text = typeof value === 'string' ? value : (JSON.stringify(value) ?? '');
  return text.length > 60 ? `${text.slice(0, 60)}…` : text;
}

function summaryLine(context: ContextFields): string {
  const aliases = context.aliases.join(', ');
  return [context.summary, context.whenToUse, aliases].find((text) => text !== null && text.trim() !== '') ?? '';
}

function issueFor(issues: Issues, path: string): string | undefined {
  return issues.find((issue) => issue.path === path || issue.path.startsWith(`${path}.`))?.message;
}

export function ContextCard({
  page,
  draft,
  onChange,
  tags,
  onTagsChange,
  issues,
  readOnly,
  labels,
}: {
  page: PageView;
  draft: PageDraftState;
  onChange(patch: Partial<Pick<PageDraftState, 'context' | 'properties'>>): void;
  tags: TagRef[];
  onTagsChange(names: string[]): Promise<void>;
  issues: Issues;
  readOnly: boolean;
  labels: ContextCardLabels;
}) {
  const client = useKnowledgeClient();
  // The server render and first client render are expanded; the stored preference applies right after hydration.
  const open = !useSyncExternalStore(subscribeCollapsed, getCollapsed, () => false);
  const [pendingTags, setPendingTags] = useState<string[] | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [issueAttempt, setIssueAttempt] = useState(0);
  const [seenIssues, setSeenIssues] = useState(issues);
  const pendingFocus = useRef<'summary' | 'whenToUse' | null>(null);
  const summaryRef = useRef<HTMLTextAreaElement>(null);
  const whenToUseRef = useRef<HTMLTextAreaElement>(null);
  const suggestTimer = useRef<ReturnType<typeof globalThis.setTimeout> | undefined>(undefined);
  const suggestSeq = useRef(0);
  const tagChain = useRef(Promise.resolve());
  const tagsInFlight = useRef(0);
  const { context, properties } = draft;
  const fields = page.noteType.fieldSchema;

  if (issues !== seenIssues) {
    setSeenIssues(issues);
    if (issues.length > 0) setIssueAttempt((count) => count + 1);
  }

  useEffect(() => () => globalThis.clearTimeout(suggestTimer.current), []);

  // A field the nudge opens the card for only exists once the card has expanded.
  useEffect(() => {
    if (!open || pendingFocus.current === null) return;
    (pendingFocus.current === 'summary' ? summaryRef : whenToUseRef).current?.focus();
    pendingFocus.current = null;
  }, [open]);

  function focusField(field: 'summary' | 'whenToUse'): void {
    pendingFocus.current = field;
    if (open) {
      (field === 'summary' ? summaryRef : whenToUseRef).current?.focus();
      pendingFocus.current = null;
    } else {
      setCollapsed(false);
    }
  }

  function setContext(patch: Partial<ContextFields>): void {
    onChange({ context: { ...context, ...patch } });
  }

  function setText(key: 'summary' | 'whenToUse' | 'source', value: string): void {
    setContext({ [key]: value === '' ? null : value });
  }

  function setProperty(key: string, value: string | number | undefined): void {
    const kept = Object.entries(properties).filter(([existing]) => existing !== key);
    onChange({ properties: Object.fromEntries(value === undefined ? kept : [...kept, [key, value]]) });
  }

  const queryTags = useCallback(
    (query: string): void => {
      globalThis.clearTimeout(suggestTimer.current);
      const prefix = query.trim().slice(0, 48);
      suggestSeq.current += 1;
      if (prefix === '') {
        setSuggestions([]);
        return;
      }
      const sequence = suggestSeq.current;
      suggestTimer.current = globalThis.setTimeout(() => {
        client.suggestTags(prefix).then(
          (found) => {
            if (sequence === suggestSeq.current) setSuggestions(found.map((tag) => tag.name));
          },
          () => {
            // Suggestions only speed up typing; without them the typed tag can still be added.
            if (sequence === suggestSeq.current) setSuggestions([]);
          },
        );
      }, SUGGEST_DEBOUNCE_MS);
    },
    [client],
  );

  function changeTags(names: string[]): void {
    setPendingTags(names);
    tagsInFlight.current += 1;
    // One request at a time, so the server ends on the order the user made the changes in.
    tagChain.current = tagChain.current.then(async () => {
      try {
        await onTagsChange(names);
      } catch {
        toast.error(labels.tagsFailed);
      } finally {
        tagsInFlight.current -= 1;
        if (tagsInFlight.current === 0) setPendingTags(null);
      }
    });
  }

  const shownTags = pendingTags ?? tags.map((tag) => tag.name);
  const missing = new Set(missingRequired(fields, properties));
  const legacy = new Set(legacyKeys(fields, properties));
  const empty = (value: string | null): boolean => value === null || value.trim() === '';
  const showNudge = page.showContextNudge && empty(context.summary) && empty(context.whenToUse);
  const line = summaryLine(context);
  const summaryText = context.summary ?? '';
  const errorOf = (path: string): string | undefined => {
    const message = issueFor(issues, path);
    return message === undefined ? undefined : labels.issue(message);
  };

  return (
    <section data-slot="context-card" className="rounded-lg bg-surface px-6 py-5">
      <Collapsible open={open} onOpenChange={(next) => setCollapsed(!next)}>
        <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-md text-left">
          <CollapsibleChevron className="shrink-0 text-fg-muted" />
          <span className="shrink-0 text-small font-medium text-fg">{labels.title}</span>
          {open ? null : (
            <span className="min-w-0 flex-1 truncate text-small text-fg-muted">{line === '' ? labels.empty : line}</span>
          )}
        </CollapsibleTrigger>
        {showNudge ? (
          <ContextNudge
            labels={labels.nudge}
            onPick={focusField}
          />
        ) : null}
        <CollapsibleContent>
          <div className="flex flex-col gap-4 pt-4">
            <FormField
              label={labels.summary}
              helper={summaryText.length > SUMMARY_COUNTER_FROM ? labels.counter(summaryText.length) : undefined}
              error={errorOf('context.summary')}
              invalidAttempt={issueAttempt}
              className={ROW_LAYOUT}
            >
              {(control) => (
                <Textarea
                  {...control}
                  ref={summaryRef}
                  value={summaryText}
                  maxLength={1000}
                  disabled={readOnly}
                  onChange={(event) => setText('summary', event.target.value)}
                />
              )}
            </FormField>
            <FormField
              label={labels.whenToUse}
              error={errorOf('context.whenToUse')}
              invalidAttempt={issueAttempt}
              className={ROW_LAYOUT}
            >
              {(control) => (
                <Textarea
                  {...control}
                  ref={whenToUseRef}
                  value={context.whenToUse ?? ''}
                  maxLength={1000}
                  disabled={readOnly}
                  onChange={(event) => setText('whenToUse', event.target.value)}
                />
              )}
            </FormField>
            <FormField
              label={labels.source}
              error={errorOf('context.source')}
              invalidAttempt={issueAttempt}
              className={ROW_LAYOUT}
            >
              {(control) => (
                <Input
                  {...control}
                  value={context.source ?? ''}
                  maxLength={500}
                  disabled={readOnly}
                  onChange={(event) => setText('source', event.target.value)}
                />
              )}
            </FormField>
            <FormField
              label={labels.aliases}
              error={errorOf('context.aliases')}
              invalidAttempt={issueAttempt}
              className={ROW_LAYOUT}
            >
              {(control) => (
                <ChipInput
                  {...control}
                  values={context.aliases}
                  onChange={(aliases) => setContext({ aliases })}
                  max={MAX_ALIASES}
                  maxChipLength={80}
                  disabled={readOnly}
                  labels={{ input: labels.aliasesPlaceholder, remove: labels.removeAlias, limit: labels.aliasesLimit }}
                />
              )}
            </FormField>
            <FormField label={labels.tags} className={ROW_LAYOUT}>
              {(control) => (
                <ChipInput
                  {...control}
                  values={shownTags}
                  onChange={changeTags}
                  max={MAX_TAGS}
                  maxChipLength={48}
                  disabled={readOnly}
                  suggestions={suggestions}
                  onQueryChange={queryTags}
                  labels={{ input: labels.tagsPlaceholder, remove: labels.removeTag, limit: labels.tagsLimit }}
                />
              )}
            </FormField>
            {fields.map((field) => (
              <TypeField
                key={field.key}
                field={field}
                value={properties[field.key]}
                missing={missing.has(field.key)}
                legacyText={legacy.has(field.key) ? legacyText(properties[field.key]) : null}
                error={errorOf(`properties.${field.key}`)}
                invalidAttempt={issueAttempt}
                readOnly={readOnly}
                labels={labels}
                onChange={(value) => setProperty(field.key, value)}
              />
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}
