import { fileTypeFromBuffer } from 'file-type';
import { attachmentKindOf, DOCX_MIME, PDF_MIME } from '../shared/attachment-kind';
import type { AttachmentKind } from '../shared/attachment-kind';

export interface FileClassification {
  mime: string;
  kind: AttachmentKind;
  extractable: boolean;
}

const OCTET_STREAM = 'application/octet-stream';
const TEXT_MIMES: readonly string[] = ['text/plain', 'text/markdown'];

// The head is cut at a byte count, so a multi-byte character may be split at its end; streaming mode waits for the rest
// instead of calling it invalid.
function isUtf8Text(head: Uint8Array): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(head, { stream: true });
    return true;
  } catch {
    return false;
  }
}

// What a file is comes from its bytes. The type the client declared only breaks the tie for plain text, which has no
// signature; anything else unknown (SVG and HTML included) is stored as opaque bytes and always downloaded.
export async function classifyFile(input: { head: Uint8Array; declaredMime: string | null }): Promise<FileClassification> {
  const detected = await fileTypeFromBuffer(input.head);
  if (detected !== undefined) {
    const kind = attachmentKindOf(detected.mime);
    const extractable = detected.mime === PDF_MIME || detected.mime === DOCX_MIME;
    return { mime: detected.mime, kind, extractable };
  }
  if (input.declaredMime !== null && TEXT_MIMES.includes(input.declaredMime) && isUtf8Text(input.head)) {
    return { mime: input.declaredMime, kind: 'file', extractable: true };
  }
  return { mime: OCTET_STREAM, kind: 'file', extractable: false };
}
