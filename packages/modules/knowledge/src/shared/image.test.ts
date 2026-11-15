import { describe, expect, it } from 'vitest';
import { getDocumentSchema } from './document-schema';

// Parse rules are plain functions, so a fake element is enough.
const rule = getDocumentSchema().nodes.image?.spec.parseDOM?.[0];
const img = (src: string) => ({ getAttribute: (name: string) => (name === 'src' ? src : null) });

describe('image paste rule', () => {
  it.each(['http://contoh.id/a.png', 'file:///C:/a.png', '/gambar/a.png', 'data:image/png;base64,AA'])(
    'drops an image from %s',
    (src) => {
      expect(rule?.getAttrs?.(img(src) as never)).toBe(false);
    },
  );

  it('keeps an https image', () => {
    // Tiptap wraps getAttrs and merges the attribute parsers into the result, so only false means rejected.
    expect(rule?.getAttrs?.(img('https://contoh.id/a.png') as never)).toMatchObject({ src: 'https://contoh.id/a.png' });
  });
});
