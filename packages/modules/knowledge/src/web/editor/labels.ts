export interface EditorLabels {
  title: string;
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
}
