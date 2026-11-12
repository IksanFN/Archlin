import { z } from 'zod';

export const OUTBOX_QUEUE = 'outbox-deliver';

// Retry shape of the pg-boss queue that carries delivery pointers (spec 12.2).
export const OUTBOX_QUEUE_OPTIONS = { retryLimit: 5, retryDelay: 10, retryBackoff: true, expireInSeconds: 900 } as const;

// A job carries only where to find the delivery, never the event: payloads can hold note content (spec 13.4 K7).
export const deliveryPointerSchema = z.strictObject({
  ownerId: z.uuid(),
  eventId: z.uuid(),
  handlerId: z.string().regex(/^[a-z][a-z0-9]{1,15}\.[a-z][a-zA-Z0-9]{0,47}$/),
});

export type DeliveryPointer = z.infer<typeof deliveryPointerSchema>;

export interface JobQueue {
  send(pointer: DeliveryPointer): Promise<void>;
}

// A delivery still 'enqueued' after this long lost its job (queue wiped, worker killed mid-flight) and is requeued.
export const ENQUEUED_TIMEOUT_MS = 300_000;
export const MAX_DELIVERY_ATTEMPTS = 10;

// Wait before a delivery whose send failed becomes due again: 2s, 4s, 8s ... capped at 5 minutes.
export function sendRetryDelayMs(attempts: number): number {
  return Math.min(2 ** attempts, 300) * 1000;
}
