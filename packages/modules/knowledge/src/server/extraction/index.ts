export { runExtractionChild } from './child';
export { DOCX_LIMITS, inspectZip } from './docx-guard';
export type { ZipSummary } from './docx-guard';
export { createAttachmentExtractionTask } from './extraction-task';
export {
  docxExtractor,
  EXTRACTION_LIMITS,
  extractText,
  normalizeExtracted,
  pdfExtractor,
  plainTextExtractor,
} from './extractors';
export { createChildProcessRunner, extractResultSchema } from './runner';
export type { ExtractionRunner } from './runner';
