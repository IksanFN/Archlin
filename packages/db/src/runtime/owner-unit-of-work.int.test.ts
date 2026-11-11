import { systemIds } from '@archlin/kernel';
import type { OwnerScope, ReadTx, WriteTx } from '@archlin/kernel';
import { issueOwnerScope } from '@archlin/kernel/trusted';
import { createTwoOwnerDatabase } from '@archlin/testing/db';
import type { TestDbUrls } from '@archlin/testing/db';
import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ownerOf, sqlFor, TransactionClosedError } from '../scoped';
import { createDatabase, createOwnerUnitOfWork } from './index';

let urls: TestDbUrls;
let ownerA: string;
let ownerB: string;
let scopeA: OwnerScope;
let scopeB: OwnerScope;
let db: Kysely<unknown>;
let uow: ReturnType<typeof createOwnerUnitOfWork>;

async function superQuery(text: string, params: unknown[] = []): Promise<pg.QueryResult> {
  const client = new pg.Client({ connectionString: urls.super });
  await client.connect();
  try {
    return await client.query(text, params);
  } finally {
    await client.end();
  }
}

const insertEvent = (tx: WriteTx, ownerId: string) =>
  sql`insert into public.security_events (owner_id, event, created_at) values (${ownerId}, 'login.success', now())`.execute(
    sqlFor(tx),
  );

beforeAll(async () => {
  ({ urls, ownerA, ownerB } = await createTwoOwnerDatabase());
  scopeA = issueOwnerScope(ownerA);
  scopeB = issueOwnerScope(ownerB);
  db = createDatabase({ connectionString: urls.app, applicationName: 'uow-test', max: 3 });
  uow = createOwnerUnitOfWork(db);
});

afterAll(async () => {
  await db.destroy();
});

describe('createOwnerUnitOfWork', () => {
  it('read transactions cannot write', async () => {
    await expect(uow.read(scopeA, (tx) => insertEvent(tx as WriteTx, ownerA))).rejects.toMatchObject({ code: '25006' });
  });

  it('write transactions can write rows of the scope owner', async () => {
    await uow.write(scopeA, (tx) => insertEvent(tx, ownerA));
    const { rows } = await superQuery('select count(*)::int as n from public.security_events where owner_id = $1', [ownerA]);
    expect(rows[0].n).toBe(1);
  });

  it('write transactions cannot write rows of another owner', async () => {
    await expect(uow.write(scopeA, (tx) => insertEvent(tx, ownerB))).rejects.toMatchObject({ code: '42501' });
  });

  it('rolls back everything when the callback throws', async () => {
    const before = await superQuery('select count(*)::int as n from public.security_events');
    await expect(
      uow.write(scopeB, async (tx) => {
        await insertEvent(tx, ownerB);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    const after = await superQuery('select count(*)::int as n from public.security_events');
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it('returns the callback result', async () => {
    expect(await uow.read(scopeA, async () => 42)).toBe(42);
  });

  it('sees only the scope owner rows', async () => {
    await uow.write(scopeB, (tx) => insertEvent(tx, ownerB));
    const ownersSeenBy = async (scope: OwnerScope) =>
      uow.read(scope, async (tx) => {
        const { rows } = await sql<{ owner_id: string }>`select distinct owner_id from public.security_events`.execute(sqlFor(tx));
        return rows.map((r) => r.owner_id);
      });
    expect(await ownersSeenBy(scopeA)).toEqual([ownerA]);
    expect(await ownersSeenBy(scopeB)).toEqual([ownerB]);
  });

  it('does not leak the owner setting to the next transaction on a reused connection', async () => {
    const db1 = createDatabase({ connectionString: urls.app, applicationName: 'test', max: 1 });
    try {
      const uow1 = createOwnerUnitOfWork(db1);
      await uow1.write(scopeA, async () => undefined);
      const { rows } = await sql<{ v: string | null }>`select nullif(current_setting('app.owner_id', true), '') as v`.execute(db1);
      expect(rows[0]?.v).toBeNull();
    } finally {
      await db1.destroy();
    }
  });

  it('keeps owners apart when concurrent transactions share a small pool', async () => {
    const observed = await Promise.all(
      Array.from({ length: 24 }, (_, i) => {
        const [scope, expected] = i % 2 === 0 ? ([scopeA, ownerA] as const) : ([scopeB, ownerB] as const);
        return uow.read(scope, async (tx) => {
          await sql`select pg_sleep(0.01)`.execute(sqlFor(tx));
          const { rows } = await sql<{ v: string }>`select current_setting('app.owner_id', true) as v`.execute(sqlFor(tx));
          return { expected, actual: rows[0]?.v };
        });
      }),
    );
    for (const { expected, actual } of observed) expect(actual).toBe(expected);
  });
});

describe('transaction handles', () => {
  it('rejects use of a transaction handle after the callback', async () => {
    let leaked: ReadTx | undefined;
    await uow.read(scopeA, async (tx) => {
      leaked = tx;
    });
    expect(() => sqlFor(leaked as ReadTx)).toThrow(TransactionClosedError);
    expect(() => ownerOf(leaked as ReadTx)).toThrow(TransactionClosedError);
  });

  it('closes the handle even when the callback throws', async () => {
    let leaked: ReadTx | undefined;
    await expect(
      uow.read(scopeA, async (tx) => {
        leaked = tx;
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(() => sqlFor(leaked as ReadTx)).toThrow(TransactionClosedError);
  });

  it('exposes the scope owner through ownerOf', async () => {
    expect(await uow.read(scopeA, async (tx) => ownerOf(tx))).toBe(ownerA);
    expect(await uow.write(scopeB, async (tx) => ownerOf(tx))).toBe(ownerB);
  });

  it('hands out frozen handles without public properties', async () => {
    await uow.write(scopeA, async (tx) => {
      expect(Object.isFrozen(tx)).toBe(true);
      expect(Reflect.ownKeys(tx)).toEqual([]);
    });
  });

  it('rejects an object that was not issued by a unit of work', () => {
    const forged = { ownerId: systemIds.uuidv7() } as unknown as ReadTx;
    expect(() => sqlFor(forged)).toThrow(TypeError);
    expect(() => ownerOf(forged)).toThrow(TypeError);
  });
});
