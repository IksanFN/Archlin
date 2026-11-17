import type { ExtractResult } from '@archlin/platform/contracts';
import { z } from 'zod';
import { ATTACHMENT_MAX_BYTES } from '../../shared/limits';
import { EXTRACTION_LIMITS, extractText } from './extractors';

const requestSchema = z.strictObject({
  mime: z.string().min(1).max(127),
  maxChars: z.int().min(1).max(EXTRACTION_LIMITS.maxChars),
});

const CORRUPT: ExtractResult = { status: 'failed', error: 'corrupt' };

// Stops reading at the cap, so a parent that streams more than an attachment may hold cannot fill this process's memory.
async function readStdin(limit: number): Promise<Uint8Array | null> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    const buffer = chunk as Buffer;
    total += buffer.length;
    if (total > limit) return null;
    chunks.push(buffer);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

async function extractFromStdin(mime: string, maxChars: number): Promise<ExtractResult> {
  const bytes = await readStdin(ATTACHMENT_MAX_BYTES);
  return bytes === null ? CORRUPT : extractText(bytes, mime, { maxChars });
}

// Entry point of the child. With an IPC channel it answers the worker: the request first, then the file on stdin, then one
// result message. Without one (run by hand) the mime type is argv[2] and the result is printed as JSON.
export function runExtractionChild(): void {
  if (process.send) {
    process.once('message', (message) => {
      const request = requestSchema.safeParse(message);
      const work = request.success ? extractFromStdin(request.data.mime, request.data.maxChars) : Promise.resolve(CORRUPT);
      void work.then((result) => process.send?.(result, () => process.exit(0)));
    });
    return;
  }
  void extractFromStdin(process.argv[2] ?? '', EXTRACTION_LIMITS.maxChars).then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  });
}
