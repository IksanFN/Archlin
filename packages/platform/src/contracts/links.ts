export type LinkKind = 'wikilink' | 'mention';

export const LINK_TITLE_MAX = 500;
export const LINK_SNIPPET_MAX = 240;

export interface LinkRef {
  kind: LinkKind;
  targetId: string | null;
  targetTitle: string;
  snippet: string;
}

export interface LinkTarget {
  id: string;
  title: string;
  icon: string | null;
  spaceSlug: string;
  trashed: boolean;
}

export interface OutboundLink {
  key: string;
  kind: LinkKind;
  targetTitle: string;
  target: LinkTarget | null;
  ambiguous: boolean;
}

export interface InboundLink {
  sourceId: string;
  title: string;
  icon: string | null;
  spaceSlug: string;
  snippet: string;
  kind: LinkKind;
}

const normalizeKey = (title: string): string => title.trim().replace(/\s+/g, ' ').toLowerCase();

// The server (outbound) and the editor both derive a link's identity from this, so the key must stay in step.
export function linkKey(ref: { targetId: string | null; targetTitle: string }): string {
  return ref.targetId ?? `t:${normalizeKey(ref.targetTitle)}`;
}
