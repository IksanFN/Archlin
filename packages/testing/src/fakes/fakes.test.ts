import { expect, it } from 'vitest';
import { FakeClock } from './fake-clock';
import { SequenceIds } from './sequence-ids';

it('FakeClock returns a copy and advances by milliseconds', () => {
  const clock = new FakeClock(new Date('2026-11-11T00:30:00.000Z'));
  const first = clock.now();
  first.setFullYear(1999);
  clock.advance(60_000);
  expect(clock.now().toISOString()).toBe('2026-11-11T00:31:00.000Z');
});

it('SequenceIds yields valid, increasing v7-shaped uuids', () => {
  const ids = new SequenceIds();
  expect(ids.uuidv7()).toBe('00000000-0000-7000-8000-000000000001');
  expect(ids.uuidv7()).toBe('00000000-0000-7000-8000-000000000002');
});
