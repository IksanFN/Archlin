import { describe, expect, it } from 'vitest';
import { defineEvent } from './events';
import { buildRegistry, defineHandler, defineModule, RegistryError } from './module';
import type { OwnerId, WriteTx } from './uow';

const anySchema = { parse: (value: unknown) => value };
const eventOf = (type: string) => defineEvent({ type, schemaVersion: 1, payload: anySchema });
const pinged = eventOf('fixture.pinged');
const ponged = eventOf('fixture.ponged');
const entityCreated = eventOf('entity.created');

const handler = (id: string, mode: 'sync' | 'async', event = pinged) =>
  defineHandler({ id, event, mode, handle: async () => {} });

describe('module registry', () => {
  it('derives namespaced kinds from local names', () => {
    const registry = buildRegistry([
      defineModule({ id: 'kb', entityKinds: { page: { label: 'Halaman', icon: 'file', treeable: true } } }),
    ]);
    expect(registry.entityKind('kb.page')).toMatchObject({ kind: 'kb.page', module: 'kb', treeable: true });
  });

  it('returns undefined for unknown kinds, events and handlers', () => {
    const registry = buildRegistry([defineModule({ id: 'fixture' })]);
    expect(registry.entityKind('fixture.nothing')).toBeUndefined();
    expect(registry.event('fixture.nothing')).toBeUndefined();
    expect(registry.handler('fixture.nothing')).toBeUndefined();
  });

  it('rejects an event outside the module namespace', () => {
    const pinged = eventOf('other.pinged');
    expect(() => buildRegistry([defineModule({ id: 'kb', events: [pinged] })])).toThrow(
      expect.objectContaining({ code: 'event_namespace_mismatch' }),
    );
  });

  it('does not treat a longer module id as a namespace prefix', () => {
    expect(() => buildRegistry([defineModule({ id: 'kb', events: [eventOf('kbx.pinged')] })])).toThrow(
      expect.objectContaining({ code: 'event_namespace_mismatch' }),
    );
  });

  it.each(['Knowledge', 'k', 'kb-x', 'a'.repeat(17), '1kb'])('rejects module id %s', (id) => {
    expect(() => buildRegistry([defineModule({ id })])).toThrow(expect.objectContaining({ code: 'invalid_module_id' }));
  });

  it('accepts module ids at the length boundaries', () => {
    const registry = buildRegistry([defineModule({ id: 'kb' }), defineModule({ id: 'a'.repeat(16) })]);
    expect(registry.moduleIds).toEqual(['kb', 'a'.repeat(16)]);
  });

  it.each(['platform', 'core', 'kernel', 'system', 'pgboss'])('rejects reserved module id %s', (id) => {
    expect(() => buildRegistry([defineModule({ id })])).toThrow(expect.objectContaining({ code: 'reserved_module_id' }));
  });

  it('rejects duplicate module ids', () => {
    expect(() => buildRegistry([defineModule({ id: 'kb' }), defineModule({ id: 'kb' })])).toThrow(
      expect.objectContaining({ code: 'duplicate_module_id' }),
    );
  });

  it.each(['Page', 'page-x', '1page', '', 'a'.repeat(49)])('rejects entity kind local name %j', (name) => {
    const draft = defineModule({ id: 'kb', entityKinds: { [name]: { label: 'x', icon: 'x', treeable: false } } });
    expect(() => buildRegistry([draft])).toThrow(expect.objectContaining({ code: 'invalid_local_name' }));
  });

  it('rejects a handler with an invalid local name', () => {
    const draft = defineModule({ id: 'fixture', events: [pinged], eventHandlers: [handler('record-ping', 'sync')] });
    expect(() => buildRegistry([draft])).toThrow(expect.objectContaining({ code: 'invalid_local_name' }));
  });

  it('rejects an event type declared twice by one module', () => {
    expect(() => buildRegistry([defineModule({ id: 'fixture', events: [pinged, pinged] })])).toThrow(
      expect.objectContaining({ code: 'duplicate_event_type' }),
    );
  });

  it('accepts platform events in the platform or entity namespace', () => {
    const loggedIn = eventOf('platform.loggedIn');
    const registry = buildRegistry([], [entityCreated, loggedIn]);
    expect(registry.event('entity.created')).toBe(entityCreated);
    expect(registry.event('platform.loggedIn')).toBe(loggedIn);
  });

  it('rejects a platform event outside the platform and entity namespaces', () => {
    expect(() => buildRegistry([], [eventOf('kb.pinged')])).toThrow(
      expect.objectContaining({ code: 'event_namespace_mismatch' }),
    );
  });

  it('rejects a platform event type registered twice', () => {
    expect(() => buildRegistry([], [entityCreated, entityCreated])).toThrow(
      expect.objectContaining({ code: 'duplicate_event_type' }),
    );
  });

  it('rejects handlers for unregistered events', () => {
    const draft = defineModule({ id: 'fixture', eventHandlers: [handler('recordPing', 'sync')] });
    expect(() => buildRegistry([draft])).toThrow(expect.objectContaining({ code: 'unknown_event' }));
  });

  it('lets a module handle a platform event or the event of another module', () => {
    const emitter = defineModule({ id: 'emitter', events: [eventOf('emitter.done')] });
    const listener = defineModule({
      id: 'listener',
      eventHandlers: [
        handler('onCreated', 'async', entityCreated),
        handler('onDone', 'sync', eventOf('emitter.done')),
      ],
    });
    const registry = buildRegistry([emitter, listener], [entityCreated]);
    expect(registry.asyncHandlersFor('entity.created').map((h) => h.id)).toEqual(['listener.onCreated']);
    expect(registry.syncHandlersFor('emitter.done').map((h) => h.id)).toEqual(['listener.onDone']);
  });

  it('separates sync and async handlers per event type', () => {
    const draft = defineModule({
      id: 'fixture',
      events: [pinged, ponged],
      eventHandlers: [
        handler('indexPing', 'sync'),
        handler('relayPing', 'async'),
        handler('indexPong', 'sync', ponged),
        handler('auditPing', 'sync'),
      ],
    });
    const registry = buildRegistry([draft]);
    expect(registry.syncHandlersFor('fixture.pinged').map((h) => h.id)).toEqual(['fixture.indexPing', 'fixture.auditPing']);
    expect(registry.asyncHandlersFor('fixture.pinged').map((h) => h.id)).toEqual(['fixture.relayPing']);
    expect(registry.syncHandlersFor('fixture.ponged').map((h) => h.id)).toEqual(['fixture.indexPong']);
    expect(registry.asyncHandlersFor('fixture.ponged')).toEqual([]);
    expect(registry.syncHandlersFor('fixture.unknown')).toEqual([]);
  });

  it('qualifies handler ids with the module id', () => {
    const draft = defineModule({ id: 'fixture', events: [pinged], eventHandlers: [handler('recordPing', 'async')] });
    const registry = buildRegistry([draft]);
    expect(registry.handler('fixture.recordPing')).toMatchObject({
      id: 'fixture.recordPing',
      moduleId: 'fixture',
      mode: 'async',
    });
    expect(registry.handler('recordPing')).toBeUndefined();
  });

  it('rejects duplicate handler ids within a module', () => {
    const draft = defineModule({
      id: 'fixture',
      events: [pinged, ponged],
      eventHandlers: [handler('record', 'sync'), handler('record', 'async', ponged)],
    });
    expect(() => buildRegistry([draft])).toThrow(expect.objectContaining({ code: 'duplicate_handler_id' }));
  });

  it('allows the same local handler name in different modules', () => {
    const make = (id: string) => defineModule({ id, eventHandlers: [handler('record', 'async', entityCreated)] });
    const registry = buildRegistry([make('alpha'), make('beta')], [entityCreated]);
    expect(registry.asyncHandlersFor('entity.created').map((h) => h.id)).toEqual(['alpha.record', 'beta.record']);
  });

  it('invokes the module handler through the registry definition', async () => {
    const seen: string[] = [];
    const draft = defineModule({
      id: 'fixture',
      events: [pinged],
      eventHandlers: [
        defineHandler({
          id: 'recordPing',
          event: pinged,
          mode: 'sync',
          handle: async (event) => {
            seen.push(event.type);
          },
        }),
      ],
    });
    const [definition] = buildRegistry([draft]).syncHandlersFor('fixture.pinged');
    await definition?.handle(
      {
        eventId: 'e1',
        ownerId: 'o1' as OwnerId,
        type: 'fixture.pinged',
        schemaVersion: 1,
        aggregateId: 'a1',
        aggregateRevision: 1,
        occurredAt: '2026-11-11T00:00:00.000Z',
        payload: {},
      },
      {} as WriteTx,
    );
    expect(seen).toEqual(['fixture.pinged']);
  });

  it('reports registry failures as RegistryError', () => {
    expect(() => buildRegistry([defineModule({ id: 'Bad' })])).toThrow(RegistryError);
  });

  it('freezes the registry', () => {
    const registry = buildRegistry([defineModule({ id: 'kb' })]);
    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(registry.moduleIds)).toBe(true);
  });
});
