import type { Clock } from '@archlin/kernel';

export class FakeClock implements Clock {
  #current: Date;

  constructor(start: Date) {
    this.#current = new Date(start.getTime());
  }

  // Returns a copy so callers cannot mutate the clock's state through the Date they receive.
  now(): Date {
    return new Date(this.#current.getTime());
  }

  advance(ms: number): void {
    this.#current = new Date(this.#current.getTime() + ms);
  }

  set(date: Date): void {
    this.#current = new Date(date.getTime());
  }
}
