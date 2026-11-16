import { DOCX_MIME } from '@archlin/modules-knowledge/shared';
import type { AttachmentView, ExtractionStatus } from '@archlin/modules-knowledge/shared';
import { FileDocIcon, FileIcon, FileImageIcon, FilePdfIcon, FileTextIcon } from '@phosphor-icons/react/ssr';
import type { Icon } from '@phosphor-icons/react';

const UNITS = ['B', 'KB', 'MB', 'GB'] as const;

export function formatBytes(size: number, locale = 'id-ID'): string {
  if (size < 1024) return `${size} B`;
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  let value = size;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${number.format(value)} ${UNITS[unit]}`;
}

export function attachmentIcon(view: Pick<AttachmentView, 'kind' | 'mime'>): Icon {
  if (view.kind === 'pdf') return FilePdfIcon;
  if (view.kind === 'image') return FileImageIcon;
  if (view.mime === DOCX_MIME) return FileDocIcon;
  if (view.mime.startsWith('text/')) return FileTextIcon;
  return FileIcon;
}

// A scan with no text needs the owner's eye; a failed extraction is an error; everything else is plain information.
export function statusTone(status: ExtractionStatus): 'muted' | 'attention' | 'danger' {
  if (status === 'no_text') return 'attention';
  return status === 'failed' ? 'danger' : 'muted';
}

// PDFs open in the browser's own viewer in a new tab; images show in the page.
export function canOpenInline(view: Pick<AttachmentView, 'kind'>): boolean {
  return view.kind === 'image' || view.kind === 'pdf';
}
