import type { LinkLabels } from '../links/page-editor-links';

export interface EditorLabels {
  links: LinkLabels;
  title: string;
  body: string;
  untitled: string;
  placeholder: string;
  headingPlaceholder: string;
  copy: string;
  copied: string;
  copyFailed: string;
  plainText: string;
  calloutVariant: string;
  callout: {
    info: string;
    warning: string;
    danger: string;
    success: string;
  };
  bold: string;
  italic: string;
  underline: string;
  strike: string;
  code: string;
  link: string;
  linkUrl: string;
  linkInvalid: string;
  linkSave: string;
  linkRemove: string;
  table: {
    addRowBelow: string;
    addColumnRight: string;
    deleteRow: string;
    deleteColumn: string;
    headerRow: string;
    deleteTable: string;
  };
  image: {
    title: string;
    url: string;
    urlInvalid: string;
    alt: string;
    altHelper: string;
    insert: string;
    loadFailed: string;
  };
  slashEmpty: string;
  slash: {
    text: string;
    heading1: string;
    heading2: string;
    heading3: string;
    bulletList: string;
    orderedList: string;
    taskList: string;
    quote: string;
    codeBlock: string;
    calloutInfo: string;
    calloutWarning: string;
    calloutDanger: string;
    calloutSuccess: string;
    details: string;
    table: string;
    divider: string;
    image: string;
  };
  block: {
    handle: string;
    moveUp: string;
    moveUpShortcut: string;
    moveDown: string;
    moveDownShortcut: string;
    duplicate: string;
    delete: string;
  };
  find: {
    find: string;
    replace: string;
    previous: string;
    next: string;
    replaceOne: string;
    replaceAll: string;
    caseSensitive: string;
    count: (current: number, total: number) => string;
    close: string;
  };
}
