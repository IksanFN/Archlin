// Checked by `pnpm typecheck`, never executed. An unused @ts-expect-error makes tsc fail, so each
// line below proves that the contract rejects the misuse it describes.
import type { EventDefinition, EventPublisher } from './events';
import type { OwnerId, OwnerUnitOfWork, ReadTx, WriteTx } from './uow';

declare const uow: OwnerUnitOfWork;
declare const publisher: EventPublisher;
declare const readTx: ReadTx;
declare const pinged: EventDefinition<{ n: number }>;

// @ts-expect-error a plain object is not an OwnerScope
void uow.read({ ownerId: 'x' as OwnerId }, async () => 1);
// @ts-expect-error publishing requires a write transaction
void publisher.publish({ definition: pinged, aggregateId: 'a', aggregateRevision: 1, payload: { n: 1 } }, readTx);
// @ts-expect-error payload must match the event definition
void publisher.publish({ definition: pinged, aggregateId: 'a', aggregateRevision: 1, payload: { n: 'x' } }, {} as WriteTx);
