import { ValidationError } from '@archlin/kernel';
import { describe, expect, it } from 'vitest';
import { emptyDocument, headingDocument } from '../shared/document-schema';
import { documentAttachmentIds } from './attachment-refs';
import { documentText, normalizeDocument, parseDocument } from './document';

function expectRejected(json: unknown, code: 'invalid_document' | 'unsafe_url') {
  try {
    parseDocument(json);
    throw new Error('expected parseDocument to throw');
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    expect(error).toMatchObject({
      code,
      details: { issues: [{ path: 'content', message: code }] },
    });
  }
}

describe('parseDocument', () => {
  it('a template document passes', () => {
    const doc = parseDocument(headingDocument(['Tujuan']));
    expect(doc.type.name).toBe('doc');
    expect(parseDocument(emptyDocument()).childCount).toBe(1);
  });

  it('rejects a root that is not doc', () => {
    expectRejected({ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }, 'invalid_document');
  });

  it('rejects an unknown node type with invalid_document', () => {
    expectRejected({ type: 'doc', content: [{ type: 'widget' }] }, 'invalid_document');
  });

  it('rejects an unknown attribute with invalid_document', () => {
    expectRejected({ type: 'doc', content: [{ type: 'paragraph', attrs: { fancy: true } }] }, 'invalid_document');
  });

  it('rejects invalid nesting with invalid_document', () => {
    expectRejected(
      {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }],
          },
        ],
      },
      'invalid_document',
    );
  });

  it('rejects a javascript link with unsafe_url', () => {
    expectRejected(
      {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'x',
                marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
              },
            ],
          },
        ],
      },
      'unsafe_url',
    );
  });

  it('rejects an http image with unsafe_url', () => {
    expectRejected(
      { type: 'doc', content: [{ type: 'image', attrs: { src: 'http://cdn.contoh.id/x.png' } }] },
      'unsafe_url',
    );
  });

  it('accepts mailto links and https images', () => {
    const doc = parseDocument({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'ops',
              marks: [{ type: 'link', attrs: { href: 'mailto:ops@contoh.id' } }],
            },
          ],
        },
        { type: 'image', attrs: { src: 'https://cdn.contoh.id/x.png' } },
      ],
    });
    expect(doc.childCount).toBe(2);
  });

  it('rejects an unknown callout variant', () => {
    expectRejected(
      {
        type: 'doc',
        content: [
          {
            type: 'callout',
            attrs: { variant: 'critical' },
            content: [{ type: 'paragraph' }],
          },
        ],
      },
      'invalid_document',
    );
  });

  it('documentText joins blocks with newlines', () => {
    const doc = parseDocument({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Tujuan' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'isi' }] },
        {
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'cek' }] }],
            },
          ],
        },
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }],
                },
              ],
            },
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'B' }] }],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(documentText(doc)).toBe('Tujuan\nisi\ncek\nA\nB');
  });
});

describe('normalizeDocument', () => {
  it('drops keys the schema does not know', () => {
    const json = normalizeDocument({ type: 'doc', junk: { a: 1 }, content: [{ type: 'paragraph' }] });
    expect(json).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
  });
});

const LINK_ID = '0197b2a0-0000-7000-8000-000000000001';
const text = (value: string) => ({ type: 'text', text: value });
const wiki = (entityId: string | null, title: string) => ({ type: 'wikiLink', attrs: { entityId, title } });
const mention = (entityId: string | null, title: string) => ({ type: 'mention', attrs: { entityId, title } });
const para = (inline: unknown[]) => ({ type: 'doc', content: [{ type: 'paragraph', content: inline }] });

describe('link nodes', () => {
  it('documentText renders link titles', () => {
    const doc = parseDocument(para([text('Lihat '), wiki(null, 'Deploy'), text(' dan '), mention(LINK_ID, 'Rudi')]));
    expect(documentText(doc)).toBe('Lihat Deploy dan @Rudi');
  });

  it('rejects a mention without an entity id and a wikiLink with an empty title', () => {
    expectRejected(para([mention(null, 'Rudi')]), 'invalid_document');
    expectRejected(para([wiki(null, '   ')]), 'invalid_document');
  });

  it('rejects a link whose id is not a uuid or whose title is longer than 500 characters', () => {
    expectRejected(para([wiki('bukan-uuid', 'Deploy')]), 'invalid_document');
    expectRejected(para([wiki(null, 'x'.repeat(501))]), 'invalid_document');
    expectRejected(para([mention(LINK_ID, 'x'.repeat(501))]), 'invalid_document');
  });

  it('keeps a valid wikiLink and mention through normalizeDocument', () => {
    const json = para([wiki(null, 'Deploy'), mention(LINK_ID, 'Rudi')]);
    expect(normalizeDocument(json)).toEqual(json);
  });
});

describe('attachment nodes', () => {
  const ID = '0197b2a0-0000-7000-8000-000000000001';
  const OTHER = '0197b2a0-0000-7000-8000-000000000002';
  const attachmentBlock = (attachmentId: unknown) => ({ type: 'attachment', attrs: { attachmentId } });
  const imageNode = (attachmentId: string | null, src: string) => ({ type: 'image', attrs: { src, attachmentId } });

  it('keeps an attachment block and an attachment image through normalizeDocument', () => {
    const json = { type: 'doc', content: [attachmentBlock(ID), imageNode(OTHER, `/files/${OTHER}`)] };
    expect(normalizeDocument(json).content).toMatchObject([
      { type: 'attachment', attrs: { attachmentId: ID } },
      { type: 'image', attrs: { src: `/files/${OTHER}`, attachmentId: OTHER } },
    ]);
  });

  it('rejects an attachment block without a uuid', () => {
    expectRejected({ type: 'doc', content: [attachmentBlock(null)] }, 'invalid_document');
    expectRejected({ type: 'doc', content: [attachmentBlock('bukan-uuid')] }, 'invalid_document');
  });

  it('rejects an attachment image whose src is not its own file url', () => {
    expectRejected({ type: 'doc', content: [imageNode(ID, `/files/${OTHER}`)] }, 'unsafe_url');
    expectRejected({ type: 'doc', content: [imageNode(ID, 'https://cdn.contoh.id/x.png')] }, 'unsafe_url');
    expectRejected({ type: 'doc', content: [imageNode(null, `/files/${ID}`)] }, 'unsafe_url');
  });

  it('documentAttachmentIds lists each id once in document order from images and attachment blocks', () => {
    const doc = parseDocument({
      type: 'doc',
      content: [
        attachmentBlock(OTHER),
        { type: 'paragraph', content: [{ type: 'text', text: 'x' }] },
        imageNode(ID, `/files/${ID}`),
        attachmentBlock(OTHER),
        imageNode(null, 'https://cdn.contoh.id/x.png'),
      ],
    });
    expect(documentAttachmentIds(doc)).toEqual([OTHER, ID]);
  });

  it('documentAttachmentIds is empty for a document without attachments', () => {
    expect(documentAttachmentIds(parseDocument(emptyDocument()))).toEqual([]);
  });
});
