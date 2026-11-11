import type { EventDefinition, EventEnvelope } from './events';
import type { WriteTx } from './uow';

export interface EntityKindDraft {
  readonly label: string;
  readonly icon: string;
  readonly treeable: boolean;
}

export interface EventHandlerDraft<TPayload = unknown> {
  readonly id: string;
  readonly event: EventDefinition<TPayload>;
  readonly mode: 'sync' | 'async';
  // Method syntax keeps the parameter bivariant, so a handler for a concrete payload fits EventHandlerDraft<unknown>.
  handle(event: EventEnvelope<TPayload>, tx: WriteTx): Promise<void>;
}

export interface ModuleDraft {
  readonly id: string;
  readonly entityKinds?: Readonly<Record<string, EntityKindDraft>>;
  readonly events?: readonly EventDefinition<unknown>[];
  readonly eventHandlers?: readonly EventHandlerDraft<unknown>[];
}

export interface EntityKindDefinition extends EntityKindDraft {
  readonly kind: string;
  readonly module: string;
}

export interface EventHandlerDefinition {
  readonly id: string;
  readonly moduleId: string;
  readonly event: EventDefinition<unknown>;
  readonly mode: 'sync' | 'async';
  handle(event: EventEnvelope<unknown>, tx: WriteTx): Promise<void>;
}

export interface ModuleRegistry {
  readonly moduleIds: readonly string[];
  entityKind(kind: string): EntityKindDefinition | undefined;
  event(type: string): EventDefinition<unknown> | undefined;
  syncHandlersFor(type: string): readonly EventHandlerDefinition[];
  asyncHandlersFor(type: string): readonly EventHandlerDefinition[];
  handler(id: string): EventHandlerDefinition | undefined;
}

export type RegistryErrorCode =
  | 'invalid_module_id'
  | 'reserved_module_id'
  | 'duplicate_module_id'
  | 'invalid_local_name'
  | 'event_namespace_mismatch'
  | 'duplicate_event_type'
  | 'unknown_event'
  | 'duplicate_handler_id';

export class RegistryError extends Error {
  override readonly name = 'RegistryError';
  readonly code: RegistryErrorCode;

  constructor(code: RegistryErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export function defineHandler<TPayload>(draft: EventHandlerDraft<TPayload>): EventHandlerDraft<TPayload> {
  return draft;
}

// `const` keeps literal types of the draft; the draft itself is returned unchanged.
export function defineModule<const T extends ModuleDraft>(draft: T): T {
  return draft;
}

const MODULE_ID = /^[a-z][a-z0-9]{1,15}$/;
const LOCAL_NAME = /^[a-z][a-zA-Z0-9]{0,47}$/;
const RESERVED_MODULE_IDS: ReadonlySet<string> = new Set(['platform', 'core', 'kernel', 'system', 'pgboss']);
const PLATFORM_EVENT_PREFIXES = ['platform.', 'entity.'] as const;

const NO_HANDLERS: readonly EventHandlerDefinition[] = Object.freeze([]);

function assertLocalName(name: string, what: string, moduleId: string): void {
  if (!LOCAL_NAME.test(name)) {
    throw new RegistryError('invalid_local_name', `Module "${moduleId}": ${what} "${name}" must match ${LOCAL_NAME}.`);
  }
}

function assertModuleId(id: string, seen: ReadonlySet<string>): void {
  if (!MODULE_ID.test(id)) {
    throw new RegistryError('invalid_module_id', `Module id "${id}" must match ${MODULE_ID}.`);
  }
  if (RESERVED_MODULE_IDS.has(id)) {
    throw new RegistryError('reserved_module_id', `Module id "${id}" is reserved.`);
  }
  if (seen.has(id)) {
    throw new RegistryError('duplicate_module_id', `Module id "${id}" is registered twice.`);
  }
}

// Validates every draft and builds an immutable lookup. Any failure throws, so the app does not start (spec 5.6).
export function buildRegistry(
  modules: readonly ModuleDraft[],
  platformEvents: readonly EventDefinition<unknown>[] = [],
): ModuleRegistry {
  const moduleIds = new Set<string>();
  const kinds = new Map<string, EntityKindDefinition>();
  const events = new Map<string, EventDefinition<unknown>>();
  const handlers = new Map<string, EventHandlerDefinition>();
  const syncByEvent = new Map<string, EventHandlerDefinition[]>();
  const asyncByEvent = new Map<string, EventHandlerDefinition[]>();

  const addEvent = (event: EventDefinition<unknown>, owner: string): void => {
    if (events.has(event.type)) {
      throw new RegistryError('duplicate_event_type', `${owner}: event type "${event.type}" is registered twice.`);
    }
    events.set(event.type, event);
  };

  for (const event of platformEvents) {
    if (!PLATFORM_EVENT_PREFIXES.some((prefix) => event.type.startsWith(prefix))) {
      throw new RegistryError(
        'event_namespace_mismatch',
        `Platform event "${event.type}" must start with one of: ${PLATFORM_EVENT_PREFIXES.join(', ')}`,
      );
    }
    addEvent(event, 'Platform');
  }

  // Pass 1 registers every module's ids, kinds and events, so a handler may refer to an event
  // declared by a module that appears later in the list.
  for (const draft of modules) {
    assertModuleId(draft.id, moduleIds);
    moduleIds.add(draft.id);

    for (const [local, kind] of Object.entries(draft.entityKinds ?? {})) {
      assertLocalName(local, 'entity kind', draft.id);
      const full = `${draft.id}.${local}`;
      kinds.set(full, Object.freeze({ ...kind, kind: full, module: draft.id }));
    }

    for (const event of draft.events ?? []) {
      if (!event.type.startsWith(`${draft.id}.`)) {
        throw new RegistryError(
          'event_namespace_mismatch',
          `Module "${draft.id}": event "${event.type}" must start with "${draft.id}.".`,
        );
      }
      addEvent(event, `Module "${draft.id}"`);
    }
  }

  for (const draft of modules) {
    for (const handlerDraft of draft.eventHandlers ?? []) {
      assertLocalName(handlerDraft.id, 'handler', draft.id);
      const id = `${draft.id}.${handlerDraft.id}`;
      if (handlers.has(id)) {
        throw new RegistryError('duplicate_handler_id', `Handler "${id}" is registered twice.`);
      }
      if (!events.has(handlerDraft.event.type)) {
        throw new RegistryError('unknown_event', `Handler "${id}" refers to unregistered event "${handlerDraft.event.type}".`);
      }

      const definition: EventHandlerDefinition = Object.freeze({
        id,
        moduleId: draft.id,
        event: handlerDraft.event,
        mode: handlerDraft.mode,
        handle: (event: EventEnvelope<unknown>, tx: WriteTx) => handlerDraft.handle(event, tx),
      });
      handlers.set(id, definition);

      const byEvent = handlerDraft.mode === 'sync' ? syncByEvent : asyncByEvent;
      const list = byEvent.get(handlerDraft.event.type) ?? [];
      list.push(definition);
      byEvent.set(handlerDraft.event.type, list);
    }
  }

  for (const list of [...syncByEvent.values(), ...asyncByEvent.values()]) Object.freeze(list);

  return Object.freeze({
    moduleIds: Object.freeze([...moduleIds]),
    entityKind: (kind: string) => kinds.get(kind),
    event: (type: string) => events.get(type),
    syncHandlersFor: (type: string) => syncByEvent.get(type) ?? NO_HANDLERS,
    asyncHandlersFor: (type: string) => asyncByEvent.get(type) ?? NO_HANDLERS,
    handler: (id: string) => handlers.get(id),
  });
}
