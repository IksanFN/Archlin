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

function intOrNull(value: string | null): number | null {
  if (value === null || value === '') return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : null;
}

export const ArchlinImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (element: { getAttribute(name: string): string | null }) => intOrNull(element.getAttribute('width')),
      },
      height: {
        default: null,
        parseHTML: (element: { getAttribute(name: string): string | null }) => intOrNull(element.getAttribute('height')),
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
