import { defineEvent } from '@archlin/kernel';
import type { EventDefinition } from '@archlin/kernel';
import { z } from 'zod';
import {
  entityCreated,
  entityDeleted,
  entityMoved,
  entityRestored,
  entityUpdated,
} from './entities/events';

export const accountCreated = defineEvent({
  type: 'platform.account.created',
  schemaVersion: 1,
  payload: z.strictObject({}),
});

export const PLATFORM_EVENTS: readonly EventDefinition<unknown>[] = [
  accountCreated,
  entityCreated,
  entityUpdated,
  entityMoved,
  entityDeleted,
  entityRestored,
];
