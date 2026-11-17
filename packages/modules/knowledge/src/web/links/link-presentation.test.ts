import type { OutboundLink } from '@archlin/platform/contracts';
import { describe, expect, it } from 'vitest';
import { linkPresentation } from './link-presentation';

const live: OutboundLink = {
  key: 'T1',
  kind: 'wikilink',
  targetTitle: 'Rollback',
  target: { id: 'T1', title: 'Rollback Postgres 16', icon: null, spaceSlug: 'kerja', trashed: false },
  ambiguous: false,
};

describe('linkPresentation', () => {
  it('a resolved link shows the current target title and its page url', () => {
    expect(linkPresentation({ entityId: 'T1', title: 'Rollback' }, live, 'wikiLink')).toEqual({
      state: 'resolved',
      label: 'Rollback Postgres 16',
      href: '/s/kerja/p/T1',
    });
  });

  it('a title link without a target is unresolved, or ambiguous when the server says so', () => {
    expect(linkPresentation({ entityId: null, title: 'Baru' }, undefined, 'wikiLink')).toEqual({
      state: 'unresolved',
      label: 'Baru',
      href: null,
    });
    const ambiguous: OutboundLink = { key: 't:catatan', kind: 'wikilink', targetTitle: 'Catatan', target: null, ambiguous: true };
    expect(linkPresentation({ entityId: null, title: 'Catatan' }, ambiguous, 'wikiLink').state).toBe('ambiguous');
  });

  it('a trashed target keeps its url and a mention gets an at sign', () => {
    const trashed: OutboundLink = { ...live, target: { id: 'T1', title: 'Rollback Postgres 16', icon: null, spaceSlug: 'kerja', trashed: true } };
    expect(linkPresentation({ entityId: 'T1', title: 'x' }, trashed, 'mention')).toEqual({
      state: 'trashed',
      label: '@Rollback Postgres 16',
      href: '/s/kerja/p/T1',
    });
  });

  it('a link the server has not described yet falls back to the stored title and the source space', () => {
    expect(linkPresentation({ entityId: 'T9', title: 'Baru dipilih' }, undefined, 'wikiLink', 'kerja')).toEqual({
      state: 'resolved',
      label: 'Baru dipilih',
      href: '/s/kerja/p/T9',
    });
    expect(linkPresentation({ entityId: 'T9', title: 'Baru dipilih' }, undefined, 'wikiLink').href).toBeNull();
    expect(linkPresentation({ entityId: 'T9', title: 'Rudi' }, undefined, 'mention').label).toBe('@Rudi');
  });
});
