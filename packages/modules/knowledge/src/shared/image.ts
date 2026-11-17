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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function attachmentUrl(id: string): string {
  return `/files/${id}`;
}

// An image either lives on the web over https, or is one of the page's own attachments and shows exactly that file.
export function isAllowedImageSrc(src: string, attachmentId: string | null): boolean {
  if (attachmentId !== null) return UUID.test(attachmentId) && src === attachmentUrl(attachmentId);
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
        getAttrs: (element) => {
          const source = element as AttributeSource;
          return isAllowedImageSrc(source.getAttribute('src') ?? '', source.getAttribute('data-attachment-id') || null) ? null : false;
        },
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
      attachmentId: {
        default: null,
        parseHTML: (element: AttributeSource) => element.getAttribute('data-attachment-id') || null,
        renderHTML: (attributes: { attachmentId?: string | null }) =>
          attributes.attachmentId ? { 'data-attachment-id': attributes.attachmentId } : {},
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
