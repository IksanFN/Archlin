import { clsx } from 'clsx';
import type { ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// Without the custom scale names, text-small would be read as a colour and clobber text-fg in the same class list.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ['h1', 'h2', 'h3', 'title', 'lead', 'body', 'small', 'nav', 'micro', 'auth-title', 'ui'],
      radius: ['pill'],
      shadow: ['overlay'],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
