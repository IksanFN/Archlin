import { describe, expect, it } from 'vitest';
import { describeUserAgent } from './user-agent';

const CHROME_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

describe('describeUserAgent', () => {
  it.each([
    [CHROME_WINDOWS, 'Chrome di Windows'],
    [`${CHROME_WINDOWS} Edg/140.0.0.0`, 'Edge di Windows'],
    [
      'Mozilla/5.0 (Linux; Android 15; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
      'Chrome di Android',
    ],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:145.0) Gecko/20100101 Firefox/145.0', 'Firefox di Windows'],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:145.0) Gecko/20100101 Firefox/145.0', 'Firefox di Linux'],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
      'Safari di macOS',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      'Safari di iOS',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1',
      'Chrome di iOS',
    ],
    ['Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36', 'Chrome di Linux'],
  ])('describes %s', (userAgent, expected) => {
    expect(describeUserAgent(userAgent)).toBe(expected);
  });

  it.each([[null], [''], ['curl/8.5.0'], ['Mozilla/5.0 (Windows NT 10.0) SomethingElse/1.0']])(
    'reports %j as an unknown device',
    (userAgent) => {
      expect(describeUserAgent(userAgent)).toBe('Perangkat tidak dikenal');
    },
  );
});
