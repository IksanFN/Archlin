import type { ExtractResult, TextExtractor } from '@archlin/platform/contracts';
import mammoth from 'mammoth';
import { extractText as extractPdfText, getDocumentProxy } from 'unpdf';
import { DOCX_MIME, PDF_MIME } from '../../shared/attachment-kind';
import { DOCX_LIMITS, inspectZip } from './docx-guard';

export const EXTRACTION_LIMITS = {
  timeoutMs: 60_000,
  maxChars: 1_000_000,
  maxOldSpaceMb: 512,
  leaseMs: 120_000,
  maxAttempts: 3,
} as const;

// One shape for every extractor, so the database never sees a NUL byte, a bare CR or a cut surrogate pair.
export function normalizeExtracted(text: string, maxChars: number): string {
  return text.replace(/\r\n?/g, '\n').replaceAll('\u0000', '').trim().slice(0, maxChars).toWellFormed();
}

function toResult(text: string, maxChars: number): ExtractResult {
  const normalized = normalizeExtracted(text, maxChars);
  return normalized === '' ? { status: 'no_text' } : { status: 'done', text: normalized };
}

const CORRUPT: ExtractResult = { status: 'failed', error: 'corrupt' };

export const pdfExtractor: TextExtractor = {
  supports: (mime) => mime === PDF_MIME,
  async extract(bytes, { maxChars }) {
    try {
      // pdf.js may hand the buffer to a worker and detach it, so it gets its own copy.
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      const { text } = await extractPdfText(pdf, { mergePages: true });
      return toResult(text, maxChars);
    } catch {
      return CORRUPT;
    }
  },
};

export const docxExtractor: TextExtractor = {
  supports: (mime) => mime === DOCX_MIME,
  async extract(bytes, { maxChars }) {
    const archive = inspectZip(bytes);
    if (archive === null) return CORRUPT;
    if (
      archive.entries > DOCX_LIMITS.maxEntries ||
      archive.uncompressed > DOCX_LIMITS.maxUncompressed ||
      archive.maxRatio > DOCX_LIMITS.maxRatio
    ) {
      return { status: 'failed', error: 'archive_limits' };
    }
    try {
      const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
      return toResult(value, maxChars);
    } catch {
      return CORRUPT;
    }
  },
};

export const plainTextExtractor: TextExtractor = {
  supports: (mime) => mime === 'text/plain' || mime === 'text/markdown',
  async extract(bytes, { maxChars }) {
    try {
      return toResult(new TextDecoder('utf-8', { fatal: true }).decode(bytes), maxChars);
    } catch {
      return CORRUPT;
    }
  },
};

const EXTRACTORS: readonly TextExtractor[] = [pdfExtractor, docxExtractor, plainTextExtractor];

export async function extractText(bytes: Uint8Array, mime: string, limits: { maxChars: number }): Promise<ExtractResult> {
  const extractor = EXTRACTORS.find((candidate) => candidate.supports(mime));
  return extractor ? extractor.extract(bytes, limits) : CORRUPT;
}
