import { PASSWORD_MIN_CHARS } from '@archlin/platform/contracts';
import { messages } from '../i18n/id';

export interface PasswordMeter {
  // Filled bar segments out of four, one per three characters.
  segments: number;
  sufficient: boolean;
  text: string;
}

// Measures length only. It claims nothing about strength because the server enforces a length rule, not an estimator.
export function passwordMeter(value: string): PasswordMeter {
  // Same counting as the server: NFC-normalised code points.
  const length = [...value.normalize('NFC')].length;
  const sufficient = length >= PASSWORD_MIN_CHARS;
  return {
    segments: Math.min(4, Math.floor(length / 3)),
    sufficient,
    text: sufficient ? messages.password.sufficient : messages.password.progress(length, PASSWORD_MIN_CHARS),
  };
}
