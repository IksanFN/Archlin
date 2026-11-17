import type { AttachmentView } from '@archlin/modules-knowledge/shared';
import { describe, expect, it } from 'vitest';
import { createUploadQueue } from './upload-queue';

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const fakeFile = (name: string): File => new File(['x'], name);
const view = (id: string): AttachmentView => ({
  id,
  pageId: 'P1',
  filename: `${id}.pdf`,
  mime: 'application/pdf',
  size: 1,
  kind: 'pdf',
  extraction: 'pending',
  referenced: true,
  trashed: false,
  createdAt: '2026-11-16T00:00:00Z',
});

describe('createUploadQueue', () => {
  it('runs at most two uploads at once and retries with the same upload id', async () => {
    const seen: string[] = [];
    let active = 0;
    let peak = 0;
    const gates: (() => void)[] = [];
    const queue = createUploadQueue({
      concurrency: 2,
      run: async (job) => {
        active += 1;
        peak = Math.max(peak, active);
        seen.push(job.uploadId);
        await new Promise<void>((resolve) => gates.push(resolve));
        active -= 1;
        throw new Error('gagal');
      },
    });
    const failed: string[] = [];
    for (const id of ['a', 'b', 'c']) {
      queue.enqueue({ id, uploadId: `up-${id}`, file: fakeFile(id) }, { onProgress() {}, onDone() {}, onFail: () => failed.push(id) });
    }
    await tick();
    expect(peak).toBe(2);
    while (gates.length > 0) {
      gates.shift()?.();
      await tick();
    }
    queue.retry('a');
    await tick();
    gates.shift()?.();
    await tick();
    expect(seen.filter((upload) => upload === 'up-a')).toHaveLength(2);
    expect(failed).toEqual(['a', 'b', 'c', 'a']);
  });

  it('reports progress and the finished attachment', async () => {
    const events: string[] = [];
    const queue = createUploadQueue({
      concurrency: 2,
      run: (job, onProgress) => {
        onProgress(0.5);
        return Promise.resolve(view(job.id));
      },
    });
    queue.enqueue(
      { id: 'a', uploadId: 'up-a', file: fakeFile('a') },
      { onProgress: (fraction) => events.push(`p${fraction}`), onDone: (done) => events.push(`done:${done.id}`), onFail() {} },
    );
    await tick();
    expect(events).toEqual(['p0.5', 'done:a']);
  });

  it('cancel aborts a running upload without reporting a failure', async () => {
    let signal: AbortSignal | undefined;
    const queue = createUploadQueue({
      concurrency: 1,
      run: (_job, _onProgress, abort) => {
        signal = abort;
        return new Promise((_resolve, reject) => {
          abort.addEventListener('abort', () => reject(new DOMException('x', 'AbortError')));
        });
      },
    });
    const failed: string[] = [];
    queue.enqueue({ id: 'a', uploadId: 'up-a', file: fakeFile('a') }, { onProgress() {}, onDone() {}, onFail: () => failed.push('a') });
    await tick();
    queue.cancel('a');
    await tick();
    expect(signal?.aborted).toBe(true);
    expect(failed).toEqual([]);
  });

  it('cancel drops a job that has not started and the next job takes the slot', async () => {
    const started: string[] = [];
    const gates: (() => void)[] = [];
    const queue = createUploadQueue({
      concurrency: 1,
      run: async (job) => {
        started.push(job.id);
        await new Promise<void>((resolve) => gates.push(resolve));
        return view(job.id);
      },
    });
    for (const id of ['a', 'b', 'c']) {
      queue.enqueue({ id, uploadId: `up-${id}`, file: fakeFile(id) }, { onProgress() {}, onDone() {}, onFail() {} });
    }
    await tick();
    queue.cancel('b');
    gates.shift()?.();
    await tick();
    expect(started).toEqual(['a', 'c']);
  });
});
