import { describe, expect, it } from 'vitest';
import { createControllableClock, handleTestRequest } from './test-mode';

const START = new Date('2026-11-11T01:00:00.000Z');

const setup = (testMode: boolean) => {
  const testClock = createControllableClock(START);
  return { container: { env: { testMode }, testClock: testMode ? testClock : null }, testClock };
};

const post = (body: unknown, path = '/__test/clock', method = 'POST') =>
  new Request(`http://localhost:3000${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
  });

describe('createControllableClock', () => {
  it('starts at the given time and moves only when told to', () => {
    const clock = createControllableClock(START);
    expect(clock.now()).toEqual(START);
    clock.advance(1500);
    expect(clock.now().toISOString()).toBe('2026-11-11T01:00:01.500Z');
    clock.set(new Date('2030-01-01T00:00:00.000Z'));
    expect(clock.now().toISOString()).toBe('2030-01-01T00:00:00.000Z');
  });

  it('returns copies so callers cannot move the clock through a Date', () => {
    const clock = createControllableClock(START);
    clock.now().setFullYear(1999);
    expect(clock.now()).toEqual(START);
  });
});

describe('handleTestRequest', () => {
  it('is inert (404) when test mode is off', async () => {
    const { container } = setup(false);
    const response = await handleTestRequest(post({ advanceMs: 1000 }), container);
    expect(response.status).toBe(404);
  });

  it('advances the clock and reports the new time', async () => {
    const { container, testClock } = setup(true);
    const response = await handleTestRequest(post({ advanceMs: 60_000 }), container);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ now: '2026-11-11T01:01:00.000Z' });
    expect(testClock.now().toISOString()).toBe('2026-11-11T01:01:00.000Z');
  });

  it('sets the clock to an absolute time', async () => {
    const { container } = setup(true);
    const response = await handleTestRequest(post({ setIso: '2027-02-03T04:05:06.000Z' }), container);
    expect(await response.json()).toEqual({ now: '2027-02-03T04:05:06.000Z' });
  });

  it.each([
    [{}],
    [{ advanceMs: 1, setIso: '2027-02-03T04:05:06.000Z' }],
    [{ advanceMs: -1 }],
    [{ advanceMs: 31_536_000_001 }],
    [{ advanceMs: 1, extra: true }],
    [{ setIso: 'besok' }],
  ])('rejects the body %o', async (body) => {
    const { container, testClock } = setup(true);
    const response = await handleTestRequest(post(body), container);
    expect(response.status).toBe(422);
    expect(testClock.now()).toEqual(START);
  });

  it('rejects malformed json and unknown paths or methods', async () => {
    const { container } = setup(true);
    const malformed = new Request('http://localhost:3000/__test/clock', { method: 'POST', body: '{nope' });
    expect((await handleTestRequest(malformed, container)).status).toBe(422);
    expect((await handleTestRequest(post({}, '/__test/other'), container)).status).toBe(404);
    expect((await handleTestRequest(post({}, '/__test/clock', 'GET'), container)).status).toBe(405);
  });
});
