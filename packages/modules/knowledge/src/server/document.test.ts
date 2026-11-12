import { ValidationError } from '@archlin/kernel';
import { describe, expect, it } from 'vitest';
import { emptyDocument, headingDocument } from '../shared/document-schema';
import { documentText, parseDocument } from './document';

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
