import type { OutboundLink } from '@archlin/platform/contracts';

export type LinkState = 'resolved' | 'unresolved' | 'ambiguous' | 'trashed';
export type LinkNodeKind = 'wikiLink' | 'mention';

export interface LinkPresentation {
  state: LinkState;
  label: string;
  href: string | null;
}

const pageHref = (spaceSlug: string, id: string): string => `/s/${spaceSlug}/p/${id}`;

// fallbackSpaceSlug covers a node the server has not described yet; the page route redirects when the slug is wrong.
export function linkPresentation(
  attrs: { entityId: string | null; title: string },
  link: OutboundLink | undefined,
  kind: LinkNodeKind,
  fallbackSpaceSlug?: string,
): LinkPresentation {
  const prefix = kind === 'mention' ? '@' : '';
  if (link?.target != null) {
    return {
      state: link.target.trashed ? 'trashed' : 'resolved',
      label: `${prefix}${link.target.title}`,
      href: pageHref(link.target.spaceSlug, link.target.id),
    };
  }
  if (attrs.entityId !== null) {
    return {
      state: 'resolved',
      label: `${prefix}${attrs.title}`,
      href: fallbackSpaceSlug === undefined ? null : pageHref(fallbackSpaceSlug, attrs.entityId),
    };
  }
  return { state: link?.ambiguous === true ? 'ambiguous' : 'unresolved', label: `${prefix}${attrs.title}`, href: null };
}
