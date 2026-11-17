import type { EditorLabels } from '../editor/labels';

// Link views only read the link group of the editor labels.
export type LabelsWithLinks = Pick<EditorLabels, 'links'>;
