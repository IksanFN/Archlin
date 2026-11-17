import { ownerOf, sqlFor } from '@archlin/db/scoped';
import { NotFoundError } from '@archlin/kernel';
import type { Clock, WriteTx } from '@archlin/kernel';
import type { BlobService, EntitiesDatabase, LinkService, TagService, TreeService } from '@archlin/platform/server';
import type { JSONContent } from '@tiptap/core';
import { sql } from 'kysely';
import { attachmentUrl } from '../shared/image';
import type { DuplicatePageInput } from '../shared/inputs';
import { documentAttachmentIds, syncAttachmentRefs } from './attachment-refs';
import type { AttachmentService } from './attachment-service';
import { documentText, normalizeDocument, parseDocument } from './document';
import { pageStateHash } from './hash';
import type { PageState } from './hash';
import { documentLinkRefs } from './links';
import { PAGE_KIND } from './module';
import { asContent, asRecord, contextOf, jsonbValue, pageInTrash } from './page-writer';
import type { KnowledgeDatabase } from './schema';

export interface IdMaps {
  pages: ReadonlyMap<string, string>;
  attachments: ReadonlyMap<string, string>;
}

// A pure copy of the document with links and attachments pointing at the copies that exist. Ids that are not in a map
// (a page outside the subtree, an external image) stay as they are.
export function remapDocument(content: JSONContent, maps: IdMaps): JSONContent {
  const visit = (node: JSONContent): JSONContent => {
    let attrs = node.attrs;
    if (node.type === 'wikiLink' || node.type === 'mention') {
      const id: unknown = attrs?.entityId;
      const copy = typeof id === 'string' ? maps.pages.get(id) : undefined;
      if (copy !== undefined) attrs = { ...attrs, entityId: copy };
    } else if (node.type === 'attachment' || node.type === 'image') {
      const id: unknown = attrs?.attachmentId;
      const copy = typeof id === 'string' ? maps.attachments.get(id) : undefined;
      if (copy !== undefined) attrs = node.type === 'image' ? { ...attrs, attachmentId: copy, src: attachmentUrl(copy) } : { ...attrs, attachmentId: copy };
    }
    return {
      ...node,
      ...(attrs === undefined ? {} : { attrs }),
      ...(node.content === undefined ? {} : { content: node.content.map(visit) }),
    };
  };
  return visit(content);
}

interface SubtreeRow {
  id: string;
  parent_id: string | null;
  space_id: string;
  title: string;
  icon: string | null;
  note_type_id: string;
  content: unknown;
  properties: unknown;
  summary: string | null;
  when_to_use: string | null;
  source: string | null;
  aliases: string[];
}

export function createPageDuplicator(deps: {
  tree: TreeService;
  tags: TagService;
  links: LinkService;
  attachments: AttachmentService;
  blobs: BlobService;
  clock: Clock;
}) {
  const { tree, tags, links, attachments, blobs, clock } = deps;

  async function requireLiveRoot(tx: WriteTx, entityId: string): Promise<{ spaceId: string }> {
    const { rows } = await sql<{ space_id: string; deleted_at: Date | null }>`
      select e.space_id, e.deleted_at from kb_pages p
      inner join entities e on e.owner_id = p.owner_id and e.id = p.entity_id
      where p.entity_id = ${entityId}`.execute(sqlFor<KnowledgeDatabase & EntitiesDatabase>(tx));
    const root = rows[0];
    if (!root) throw new NotFoundError('page_not_found', 'Halaman tidak ditemukan');
    if (root.deleted_at !== null) pageInTrash();
    return { spaceId: root.space_id };
  }

  // Live pages only, parents before children, siblings in their tree order.
  async function readSubtree(tx: WriteTx, rootId: string): Promise<SubtreeRow[]> {
    const { rows } = await sql<SubtreeRow>`
      with recursive subtree as (
        select e.id, e.parent_id, e.space_id, e.title, e.icon, e.position, 0 as depth
        from entities e where e.id = ${rootId}
        union all
        select c.id, c.parent_id, c.space_id, c.title, c.icon, c.position, s.depth + 1
        from entities c inner join subtree s on c.parent_id = s.id
        where c.kind = ${PAGE_KIND} and c.deleted_at is null
      )
      select s.id, s.parent_id, s.space_id, s.title, s.icon, p.note_type_id, p.content, p.properties,
             p.summary, p.when_to_use, p.source, p.aliases
      from subtree s inner join kb_pages p on p.entity_id = s.id
      order by s.depth, s.position`.execute(sqlFor<KnowledgeDatabase & EntitiesDatabase>(tx));
    return rows;
  }

  return async function duplicatePage(tx: WriteTx, input: DuplicatePageInput): Promise<{ entityId: string; spaceSlug: string; count: number }> {
    // The blob lock is taken before the first tree write, the order every other transaction that needs both keeps.
    await blobs.lock(tx);
    const root = await requireLiveRoot(tx, input.entityId);
    const rows = await readSubtree(tx, input.entityId);
    const trx = sqlFor<KnowledgeDatabase & EntitiesDatabase>(tx);

    const copies = new Map<string, string>();
    const titles = new Map<string, string>();
    for (const row of rows) {
      const isRoot = row.id === input.entityId;
      const parentId = isRoot ? row.parent_id : (copies.get(row.parent_id ?? '') ?? null);
      if (!isRoot && parentId === null) throw new Error('subtree row without a copied parent');
      const entity = await tree.create(tx, {
        kind: PAGE_KIND,
        spaceId: row.space_id,
        parentId,
        title: isRoot ? input.rootTitle : row.title,
        icon: row.icon,
        placement: isRoot ? { afterId: row.id } : 'last',
      });
      copies.set(row.id, entity.id);
      titles.set(row.id, entity.title);
    }

    // Each copy owns copies of the files its page shows, also those that live on another page.
    const attachmentCopies = new Map<string, Map<string, string>>();
    for (const row of rows) {
      const shown = (await attachments.listForPage(tx, row.id)).map((attachment) => attachment.id);
      const target = copies.get(row.id) ?? '';
      attachmentCopies.set(
        row.id,
        new Map(shown.length === 0 ? [] : Object.entries(await attachments.copyToPage(tx, { pageId: target, attachmentIds: shown }))),
      );
    }

    const now = clock.now();
    for (const row of rows) {
      const copyId = copies.get(row.id) ?? '';
      const title = titles.get(row.id) ?? row.title;
      const content = normalizeDocument(
        remapDocument(asContent(row.content), { pages: copies, attachments: attachmentCopies.get(row.id) ?? new Map() }),
      );
      const doc = parseDocument(content);
      const state: PageState = {
        title,
        content,
        context: contextOf(row),
        properties: asRecord(row.properties),
        noteTypeId: row.note_type_id,
      };
      await trx
        .insertInto('kb_pages')
        .values({
          owner_id: ownerOf(tx),
          entity_id: copyId,
          kind: PAGE_KIND,
          note_type_id: row.note_type_id,
          content: jsonbValue(content),
          content_text: documentText(doc),
          content_hash: pageStateHash(state),
          properties: jsonbValue(state.properties),
          summary: row.summary,
          when_to_use: row.when_to_use,
          source: row.source,
          aliases: [...row.aliases],
          version: 1,
          last_saved_at: now,
          last_snapshot_at: null,
        })
        .execute();
      const refs = documentLinkRefs(doc);
      if (refs.length > 0) {
        await links.sync(tx, { sourceId: copyId, spaceId: row.space_id, refs, inheritFrom: { sourceId: row.id, remap: copies } });
      }
      await syncAttachmentRefs(tx, copyId, documentAttachmentIds(doc));
      if (title !== '') await links.resolvePending(tx, { entityId: copyId, title });
      const tagNames = (await tags.forEntity(tx, row.id)).map((tag) => tag.name);
      if (tagNames.length > 0) await tags.setForEntity(tx, copyId, tagNames);
    }

    const space = await trx.selectFrom('spaces').select('slug').where('id', '=', root.spaceId).executeTakeFirst();
    if (!space) throw new NotFoundError('space_not_found', 'Space tidak ditemukan');
    return { entityId: copies.get(input.entityId) ?? '', spaceSlug: space.slug, count: rows.length };
  };
}
