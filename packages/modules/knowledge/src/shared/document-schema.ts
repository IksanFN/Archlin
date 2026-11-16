import { getSchema, type Extensions, type JSONContent } from '@tiptap/core';
import { CodeBlock } from '@tiptap/extension-code-block';
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { TableKit } from '@tiptap/extension-table';
import type { Schema } from '@tiptap/pm/model';
import { StarterKit } from '@tiptap/starter-kit';
import { AttachmentNode } from './attachment-node';
import { Callout } from './callout';
import { ArchlinHeading } from './heading';
import { ArchlinImage, isAllowedLink } from './image';
import { Mention } from './mention';
import { WikiLink } from './wiki-link';

export { AttachmentNode } from './attachment-node';
export { CALLOUT_VARIANTS, Callout } from './callout';
export type { CalloutVariant } from './callout';
export { ArchlinHeading } from './heading';
export { ALLOWED_LINK_PROTOCOLS, ArchlinImage, attachmentUrl, isAllowedImageSrc, isAllowedLink } from './image';
export { Mention } from './mention';
export { WikiLink } from './wiki-link';

export function contentExtensions(): Extensions {
  return [
    StarterKit.configure({
      heading: false,
      codeBlock: false,
      link: {
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        defaultProtocol: 'https',
        isAllowedUri: (url, ctx) => ctx.defaultValidate(url) && isAllowedLink(url),
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      },
    }),
    ArchlinHeading,
    // Declared beside StarterKit so the web editor can swap in CodeBlockLowlight with the same schema.
    CodeBlock,
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: false } }),
    Details,
    DetailsSummary,
    DetailsContent,
    ArchlinImage,
    Callout,
    WikiLink,
    Mention,
    AttachmentNode,
  ];
}

let schema: Schema | undefined;

export function getDocumentSchema(): Schema {
  schema ??= getSchema(contentExtensions());
  return schema;
}

export function emptyDocument(): JSONContent {
  return { type: 'doc', content: [{ type: 'paragraph' }] };
}

export function headingDocument(headings: readonly string[]): JSONContent {
  return {
    type: 'doc',
    content: headings.flatMap((text) => [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text }] },
      { type: 'paragraph' },
    ]),
  };
}
