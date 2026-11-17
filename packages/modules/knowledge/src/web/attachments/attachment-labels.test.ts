import type { AttachmentView } from '@archlin/modules-knowledge/shared';
import { FileDocIcon, FileIcon, FileImageIcon, FilePdfIcon, FileTextIcon } from '@phosphor-icons/react/ssr';
import { describe, expect, it } from 'vitest';
import { attachmentIcon, canOpenInline, formatBytes, statusTone } from './attachment-labels';

const view: AttachmentView = {
  id: 'A1',
  pageId: 'P1',
  filename: 'a.bin',
  mime: 'application/octet-stream',
  size: 1,
  kind: 'file',
  extraction: 'pending',
  referenced: true,
  trashed: false,
  createdAt: '2026-11-16T00:00:00Z',
};

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [1023, '1023 B'],
    [1536, '1,5 KB'],
    [1_258_291, '1,2 MB'],
    [52_428_800, '50 MB'],
    [3 * 1024 ** 3, '3 GB'],
  ])('formatBytes(%i)', (size, expected) => {
    expect(formatBytes(size)).toBe(expected);
  });
});

describe('attachmentIcon', () => {
  it('picks an icon by kind and type', () => {
    expect(attachmentIcon({ kind: 'pdf', mime: 'application/pdf' })).toBe(FilePdfIcon);
    expect(attachmentIcon({ kind: 'image', mime: 'image/png' })).toBe(FileImageIcon);
    expect(attachmentIcon({ kind: 'file', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })).toBe(FileDocIcon);
    expect(attachmentIcon({ kind: 'file', mime: 'text/markdown' })).toBe(FileTextIcon);
    expect(attachmentIcon({ kind: 'file', mime: 'application/zip' })).toBe(FileIcon);
  });
});

describe('statusTone', () => {
  it('marks scans for attention and failures as danger', () => {
    expect([statusTone('no_text'), statusTone('failed'), statusTone('done'), statusTone('pending'), statusTone('unsupported')]).toEqual([
      'attention',
      'danger',
      'muted',
      'muted',
      'muted',
    ]);
  });
});

describe('canOpenInline', () => {
  it('only images and pdfs open inline', () => {
    expect(canOpenInline({ ...view, kind: 'pdf' })).toBe(true);
    expect(canOpenInline({ ...view, kind: 'image' })).toBe(true);
    expect(canOpenInline({ ...view, kind: 'file' })).toBe(false);
  });
});
