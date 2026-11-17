import { linkKey } from '@archlin/platform/contracts';
import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { NodeView } from '@tiptap/pm/view';
import type { LabelsWithLinks } from './labels';
import { linkPresentation } from './link-presentation';
import type { LinkNodeKind, LinkPresentation } from './link-presentation';
import type { PageEditorLinks } from './page-editor-links';

export const OPEN_LINK_POPOVER = 'kb-open-link-popover';

export interface OpenLinkPopoverDetail {
  pos: number;
  title: string;
  state: 'unresolved' | 'ambiguous';
  anchor: HTMLElement;
}

interface NodeViewContext {
  kind: LinkNodeKind;
  editor: Editor;
  links: PageEditorLinks;
  labels: LabelsWithLinks;
  getPos: () => number | undefined;
}

const PLAIN_LEFT_CLICK = (event: MouseEvent): boolean =>
  event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;

// The node stores the title as typed; label, address and trash state are read from the store so a rename shows without a document edit.
export class LinkNodeView implements NodeView {
  readonly dom: HTMLElement;
  private node: ProseMirrorNode;
  private shown = '';
  private readonly stopStore: () => void;
  private readonly onEditorUpdate = (): void => this.render();
  private readonly context: NodeViewContext;

  constructor(node: ProseMirrorNode, context: NodeViewContext) {
    this.context = context;
    this.node = node;
    this.dom = document.createElement('span');
    this.dom.className = 'kb-link-wrap';
    this.dom.setAttribute('data-kind', context.kind);
    this.stopStore = context.links.store.subscribe(() => this.render());
    // setEditable emits update, which is the only signal a link gets when the page goes read-only.
    context.editor.on('update', this.onEditorUpdate);
    this.render();
  }

  update(node: ProseMirrorNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }

  stopEvent(event: Event): boolean {
    return event.type === 'click' || event.type === 'mousedown' || event.type === 'keydown';
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy(): void {
    this.stopStore();
    this.context.editor.off('update', this.onEditorUpdate);
  }

  private presentation(): LinkPresentation {
    const attrs = { entityId: (this.node.attrs.entityId as string | null) ?? null, title: String(this.node.attrs.title ?? '') };
    const { links, kind } = this.context;
    return linkPresentation(attrs, links.store.get(linkKey({ targetId: attrs.entityId, targetTitle: attrs.title })), kind, links.spaceSlug);
  }

  private render(): void {
    const presentation = this.presentation();
    const editable = this.context.editor.isEditable;
    const signature = `${presentation.state}|${presentation.label}|${presentation.href ?? ''}|${editable}`;
    if (signature === this.shown) return;
    this.shown = signature;
    this.dom.setAttribute('data-state', presentation.state);
    this.dom.replaceChildren(this.control(presentation, editable));
  }

  private control(presentation: LinkPresentation, editable: boolean): HTMLElement {
    const { state, label, href } = presentation;
    if (href !== null) {
      const anchor = document.createElement('a');
      anchor.className = 'kb-link';
      anchor.href = href;
      anchor.textContent = label;
      if (state === 'trashed') anchor.title = this.context.labels.links.inTrash;
      anchor.addEventListener('click', (event) => {
        if (!PLAIN_LEFT_CLICK(event)) return;
        event.preventDefault();
        this.context.links.navigate(href);
      });
      return anchor;
    }
    if (!editable) {
      const text = document.createElement('span');
      text.className = 'kb-link';
      text.textContent = label;
      return text;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'kb-link';
    button.textContent = label;
    button.setAttribute('aria-haspopup', 'dialog');
    button.addEventListener('click', () => {
      const pos = this.context.getPos();
      if (pos === undefined) return;
      const detail: OpenLinkPopoverDetail = {
        pos,
        title: String(this.node.attrs.title ?? ''),
        state: state === 'ambiguous' ? 'ambiguous' : 'unresolved',
        anchor: button,
      };
      this.dom.dispatchEvent(new CustomEvent<OpenLinkPopoverDetail>(OPEN_LINK_POPOVER, { bubbles: true, detail }));
    });
    return button;
  }
}
