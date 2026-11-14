import { Image } from '@tiptap/extension-image';

export const ALLOWED_LINK_PROTOCOLS = ['http:', 'https:', 'mailto:'] as const;

function protocolOf(value: string): string | null {
  if (value.length === 0 || !URL.canParse(value)) return null;
  return new URL(value).protocol;
}

export function isAllowedLink(href: string): boolean {
  const protocol = protocolOf(href);
  return protocol !== null && (ALLOWED_LINK_PROTOCOLS as readonly string[]).includes(protocol);
}

export function isAllowedImageSrc(src: string): boolean {
  return protocolOf(src) === 'https:';
}

interface AttributeSource {
  getAttribute(name: string): string | null;
}

function intOrNull(value: string | null): number | null {
  if (value === null || value === '') return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : null;
}

export const ArchlinImage = Image.extend({
  // The server rejects any non-https image, so pasted or dropped HTML must not carry one into the editor.
  parseHTML() {
    return [
      {
        tag: 'img[src]',
        getAttrs: (element) => (isAllowedImageSrc((element as AttributeSource).getAttribute('src') ?? '') ? null : false),
      },
    ];
  },

  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (element: AttributeSource) => intOrNull(element.getAttribute('width')),
      },
      height: {
        default: null,
        parseHTML: (element: AttributeSource) => intOrNull(element.getAttribute('height')),
      },
    };
  },
}).configure({
  allowBase64: false,
  HTMLAttributes: {
    referrerpolicy: 'no-referrer',
    loading: 'lazy',
  },
});
