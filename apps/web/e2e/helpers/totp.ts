import type { APIRequestContext } from '@playwright/test';
import { generate } from 'otplib';

// The server runs on a controllable clock in test mode, so codes are computed against its time, not the runner's.
export async function serverNow(request: APIRequestContext): Promise<Date> {
  return clockCall(request, { advanceMs: 0 });
}

export async function advanceClock(request: APIRequestContext, ms: number): Promise<void> {
  await clockCall(request, { advanceMs: ms });
}

async function clockCall(request: APIRequestContext, body: { advanceMs: number }): Promise<Date> {
  const response = await request.post('/__test/clock', { data: body });
  if (!response.ok()) throw new Error(`/__test/clock answered ${response.status()}`);
  const { now } = (await response.json()) as { now: string };
  return new Date(now);
}

export async function totpCode(secret: string, at: Date): Promise<string> {
  return generate({ secret, epoch: Math.floor(at.getTime() / 1000) });
}
