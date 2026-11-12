import { useSyncExternalStore } from 'react';
import { initialTimezone, timezoneOptions } from './timezones';

interface TimezoneChoices {
  options: readonly string[];
  initial: string;
}

// The server knows neither the visitor zone nor the browser zone list, so it renders one fixed option and the
// browser swaps in the real list after hydration; a plain useState would hydrate with mismatched markup.
const SERVER_CHOICES: TimezoneChoices = { options: ['Asia/Jakarta'], initial: 'Asia/Jakarta' };
let browserChoices: TimezoneChoices | null = null;

function readBrowserChoices(): TimezoneChoices {
  if (browserChoices === null) {
    const options = timezoneOptions();
    browserChoices = { options, initial: initialTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone, options) };
  }
  return browserChoices;
}

const subscribeNever = (): (() => void) => () => undefined;

export function useTimezoneChoices(): TimezoneChoices {
  return useSyncExternalStore(subscribeNever, readBrowserChoices, () => SERVER_CHOICES);
}
