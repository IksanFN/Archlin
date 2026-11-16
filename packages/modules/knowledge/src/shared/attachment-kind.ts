export type ExtractionStatus = 'pending' | 'done' | 'no_text' | 'unsupported' | 'failed';

export type AttachmentKind = 'image' | 'pdf' | 'file';

// Only formats that every current browser renders inline and that carry no script; SVG is deliberately absent.
export const IMAGE_MIMES: readonly string[] = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'];

export const PDF_MIME = 'application/pdf';

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export function attachmentKindOf(mime: string): AttachmentKind {
  if (IMAGE_MIMES.includes(mime)) return 'image';
  return mime === PDF_MIME ? 'pdf' : 'file';
}
