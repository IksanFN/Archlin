import type {
  AttachmentView,
  ChangeNoteTypeInput,
  CopyAttachmentsInput,
  CreateLinkedPageInput,
  CreateNoteTypeInput,
  DeleteNoteTypeInput,
  DuplicatePageInput,
  ListVersionsInput,
  NoteTypeDetail,
  NoteTypeSummary,
  OverwritePageInput,
  PageScreen,
  PageSuggestion,
  PageView,
  RestoreVersionInput,
  RestoreVersionResult,
  SavePageInput,
  SaveResult,
  SnapshotPageInput,
  SnapshotResult,
  SuggestPagesInput,
  TrashOrphansInput,
  UpdateNoteTypeInput,
  VersionDetail,
  VersionInput,
  VersionPage,
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

export interface UploadFileInput {
  pageId: string;
  // One id per file the user picked: resending it after a lost response returns the first attachment instead of a second.
  uploadId: string;
  file: File;
}

export interface UploadFileResult {
  attachment: AttachmentView;
  created: boolean;
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
  suggestPages(input: SuggestPagesInput): Promise<PageSuggestion[]>;
  createLinkedPage(input: CreateLinkedPageInput): Promise<{ entityId: string; spaceSlug: string }>;
  duplicatePage(input: DuplicatePageInput): Promise<{ entityId: string; spaceSlug: string; count: number }>;
  listVersions(input: ListVersionsInput): Promise<VersionPage>;
  getVersion(input: VersionInput): Promise<VersionDetail>;
  snapshotPage(input: SnapshotPageInput): Promise<SnapshotResult>;
  restoreVersion(input: RestoreVersionInput): Promise<RestoreVersionResult>;
  listAttachments(pageId: string): Promise<AttachmentView[]>;
  trashOrphanAttachments(input: TrashOrphansInput): Promise<{ trashed: number }>;
  retryExtraction(attachmentId: string): Promise<AttachmentView>;
  copyAttachments(input: CopyAttachmentsInput): Promise<Record<string, string>>;
  uploadFile(input: UploadFileInput, onProgress: (fraction: number) => void, signal: AbortSignal): Promise<UploadFileResult>;
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
