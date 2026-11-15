import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export interface FindMatch {
  from: number;
  to: number;
}

export interface FindReplaceState {
  open: boolean;
  openedAt: number;
  query: string;
  replacement: string;
  caseSensitive: boolean;
  matches: FindMatch[];
  activeIndex: number;
}

export const findReplaceKey = new PluginKey<FindReplaceState>('findReplace');

const emptyState: FindReplaceState = {
  open: false,
  openedAt: 0,
  query: '',
  replacement: '',
  caseSensitive: false,
  matches: [],
  activeIndex: 0,
};

// Object replacement character so leaf nodes such as hard breaks occupy one offset, matching their PM position.
const LEAF = '\uFFFC';

export function findMatches(doc: ProseMirrorNode, query: string, caseSensitive: boolean): FindMatch[] {
  if (query.length === 0) return [];
  const matches: FindMatch[] = [];
  const needle = caseSensitive ? query : query.toLocaleLowerCase();
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const start = pos + 1;
    const text = node.textBetween(0, node.content.size, undefined, LEAF);
    const haystack = caseSensitive ? text : text.toLocaleLowerCase();
    let from = 0;
    while (from + needle.length <= haystack.length) {
      const index = haystack.indexOf(needle, from);
      if (index === -1) break;
      matches.push({ from: start + index, to: start + index + query.length });
      from = index + needle.length;
    }
    return true;
  });
  return matches;
}

export function replaceMatch(state: EditorState, match: FindMatch, replacement: string): Transaction {
  return state.tr.insertText(replacement, match.from, match.to);
}

export function replaceAll(state: EditorState, matches: readonly FindMatch[], replacement: string): Transaction {
  const tr = state.tr;
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    const match = matches[i];
    if (match === undefined) continue;
    tr.insertText(replacement, match.from, match.to);
  }
  return tr;
}

function withMatches(value: FindReplaceState, doc: ProseMirrorNode): FindReplaceState {
  if (!value.open) return emptyState;
  const matches = findMatches(doc, value.query, value.caseSensitive);
  const activeIndex = matches.length === 0 ? 0 : Math.min(value.activeIndex, matches.length - 1);
  return { ...value, matches, activeIndex };
}

function scrollToActive(editor: { view: { dom: Element } }): void {
  queueMicrotask(() => {
    editor.view.dom.querySelector('.find-active')?.scrollIntoView({ block: 'nearest' });
  });
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    findReplace: {
      openFind: () => ReturnType;
      closeFind: () => ReturnType;
      setFindQuery: (query: string) => ReturnType;
      setFindReplacement: (replacement: string) => ReturnType;
      toggleFindCase: () => ReturnType;
      findNext: () => ReturnType;
      findPrevious: () => ReturnType;
      replaceFind: () => ReturnType;
      replaceAllFind: () => ReturnType;
    };
  }
}

export const FindReplace = Extension.create({
  name: 'findReplace',

  addCommands() {
    return {
      openFind:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch !== undefined) {
            dispatch(tr.setMeta(findReplaceKey, { open: true, openedAt: Date.now() }));
          }
          return true;
        },
      closeFind:
        () =>
        ({ tr, dispatch, editor }) => {
          const value = findReplaceKey.getState(editor.state);
          if (value === undefined || !value.open) return false;
          if (dispatch !== undefined) {
            dispatch(tr.setMeta(findReplaceKey, { open: false }));
            queueMicrotask(() => {
              editor.commands.focus();
            });
          }
          return true;
        },
      setFindQuery:
        (query: string) =>
        ({ tr, dispatch }) => {
          if (dispatch !== undefined) dispatch(tr.setMeta(findReplaceKey, { query, activeIndex: 0 }));
          return true;
        },
      setFindReplacement:
        (replacement: string) =>
        ({ tr, dispatch }) => {
          if (dispatch !== undefined) dispatch(tr.setMeta(findReplaceKey, { replacement }));
          return true;
        },
      toggleFindCase:
        () =>
        ({ tr, dispatch, state }) => {
          const value = findReplaceKey.getState(state);
          if (value === undefined) return false;
          if (dispatch !== undefined) {
            dispatch(tr.setMeta(findReplaceKey, { caseSensitive: !value.caseSensitive, activeIndex: 0 }));
          }
          return true;
        },
      findNext:
        () =>
        ({ tr, dispatch, state, editor }) => {
          const value = findReplaceKey.getState(state);
          if (value === undefined || value.matches.length === 0) return false;
          const activeIndex = (value.activeIndex + 1) % value.matches.length;
          if (dispatch !== undefined) {
            dispatch(tr.setMeta(findReplaceKey, { activeIndex }));
            scrollToActive(editor);
          }
          return true;
        },
      findPrevious:
        () =>
        ({ tr, dispatch, state, editor }) => {
          const value = findReplaceKey.getState(state);
          if (value === undefined || value.matches.length === 0) return false;
          const activeIndex = (value.activeIndex - 1 + value.matches.length) % value.matches.length;
          if (dispatch !== undefined) {
            dispatch(tr.setMeta(findReplaceKey, { activeIndex }));
            scrollToActive(editor);
          }
          return true;
        },
      replaceFind:
        () =>
        ({ state, dispatch, editor }) => {
          if (!editor.isEditable) return false;
          const value = findReplaceKey.getState(state);
          if (value === undefined) return false;
          const match = value.matches[value.activeIndex];
          if (match === undefined) return false;
          const tr = replaceMatch(state, match, value.replacement);
          if (dispatch !== undefined) {
            dispatch(tr.setMeta(findReplaceKey, {}));
            scrollToActive(editor);
          }
          return true;
        },
      replaceAllFind:
        () =>
        ({ state, dispatch, editor }) => {
          if (!editor.isEditable) return false;
          const value = findReplaceKey.getState(state);
          if (value === undefined || value.matches.length === 0) return false;
          const tr = replaceAll(state, value.matches, value.replacement);
          if (dispatch !== undefined) dispatch(tr.setMeta(findReplaceKey, { activeIndex: 0 }));
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      // Bound on the editor view so Mod-f outside it stays the browser find dialog.
      'Mod-f': ({ editor }) => {
        editor.commands.openFind();
        return true;
      },
      Escape: ({ editor }) => editor.commands.closeFind(),
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<FindReplaceState>({
        key: findReplaceKey,
        state: {
          init: () => emptyState,
          apply: (tr, value) => {
            const meta = tr.getMeta(findReplaceKey) as Partial<FindReplaceState> | undefined;
            const next = meta === undefined ? value : { ...value, ...meta };
            if (!next.open) return emptyState;
            if (meta !== undefined || tr.docChanged) return withMatches(next, tr.doc);
            return next;
          },
        },
        props: {
          decorations(state) {
            const value = findReplaceKey.getState(state);
            if (value === undefined || !value.open || value.matches.length === 0) return null;
            return DecorationSet.create(
              state.doc,
              value.matches.map((match, index) =>
                Decoration.inline(match.from, match.to, {
                  class: index === value.activeIndex ? 'find-match find-active' : 'find-match',
                }),
              ),
            );
          },
        },
      }),
    ];
  },
});
