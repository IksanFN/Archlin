import type {
  ChangeNoteTypeInput,
  CreateNoteTypeInput,
  DeleteNoteTypeInput,
  NoteTypeDetail,
  NoteTypeSummary,
  OverwritePageInput,
  PageScreen,
  PageView,
  SavePageInput,
  SaveResult,
  UpdateNoteTypeInput,
} from '@archlin/modules-knowledge/shared';
import type { ReorderInput, TagRef } from '@archlin/platform/contracts';
import { createContext, use } from 'react';
import type { ReactNode } from 'react';

export class KnowledgeClientError extends Error {
  override readonly name = 'KnowledgeClientError';
  readonly code: string;
  readonly status: number;
  readonly details: unknown;
  readonly requestId: string | null;

  constructor({
    code,
    message,
    status,
    details = null,
    requestId = null,
  }: {
    code: string;
    message: string;
    status: number;
    details?: unknown;
    requestId?: string | null;
  }) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
    this.requestId = requestId;
  }
}

export interface KnowledgeClient {
  savePage(input: SavePageInput): Promise<SaveResult>;
  saveConflictCopy(input: SavePageInput): Promise<{ versionId: string }>;
  overwritePage(input: OverwritePageInput): Promise<SaveResult>;
  getPage(entityId: string): Promise<PageScreen>;
  changeNoteType(input: ChangeNoteTypeInput): Promise<PageView>;
  suggestTags(prefix: string): Promise<TagRef[]>;
  setTags(entityId: string, names: readonly string[]): Promise<TagRef[]>;
  listNoteTypes(): Promise<NoteTypeSummary[]>;
  getNoteType(id: string): Promise<NoteTypeDetail>;
  createNoteType(input: CreateNoteTypeInput): Promise<NoteTypeDetail>;
  updateNoteType(input: UpdateNoteTypeInput): Promise<NoteTypeDetail>;
  reorderNoteType(input: ReorderInput): Promise<void>;
  deleteNoteType(input: DeleteNoteTypeInput): Promise<{ reassigned: number }>;
}

const KnowledgeClientContext = createContext<KnowledgeClient | null>(null);

export function KnowledgeClientProvider({ client, children }: { client: KnowledgeClient; children: ReactNode }) {
  return <KnowledgeClientContext value={client}>{children}</KnowledgeClientContext>;
}

export function useKnowledgeClient(): KnowledgeClient {
  const client = use(KnowledgeClientContext);
  if (client === null) throw new Error('useKnowledgeClient needs a KnowledgeClientProvider above it');
  return client;
}
