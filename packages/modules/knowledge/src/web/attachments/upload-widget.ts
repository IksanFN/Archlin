import type { AttachmentLabels } from './labels';

export interface UploadWidget {
  element: HTMLElement;
  setProgress(fraction: number): void;
  setUploading(): void;
  setFailed(): void;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = 'kb-upload-action';
  element.textContent = label;
  element.addEventListener('click', onClick);
  return element;
}

// A plain DOM block so ProseMirror can place it as a widget; the extension owns its state and calls the setters.
export function createUploadWidget(options: {
  name: string;
  labels: AttachmentLabels;
  onCancel: () => void;
  onRetry: () => void;
  onDiscard: () => void;
}): UploadWidget {
  const { name, labels } = options;
  const element = document.createElement('div');
  element.className = 'kb-upload';
  element.setAttribute('role', 'group');
  element.setAttribute('aria-label', name);
  element.contentEditable = 'false';

  const title = document.createElement('span');
  title.className = 'kb-upload-name';
  title.textContent = name;

  const bar = document.createElement('div');
  bar.className = 'kb-upload-bar';
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-label', labels.uploadProgress(name));
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', '100');
  bar.setAttribute('aria-valuenow', '0');
  const fill = document.createElement('div');
  fill.className = 'kb-upload-fill';
  bar.append(fill);

  const failure = document.createElement('span');
  failure.className = 'kb-upload-failure';
  failure.textContent = labels.uploadFailed(name);

  const actions = document.createElement('span');
  actions.className = 'kb-upload-actions';

  function setUploading(): void {
    element.dataset.state = 'uploading';
    actions.replaceChildren(button(labels.cancel, options.onCancel));
    fill.style.transform = 'scaleX(0)';
    bar.setAttribute('aria-valuenow', '0');
  }

  function setFailed(): void {
    element.dataset.state = 'failed';
    actions.replaceChildren(button(labels.retry, options.onRetry), button(labels.discard, options.onDiscard));
  }

  element.append(title, bar, failure, actions);
  setUploading();

  return {
    element,
    setUploading,
    setFailed,
    setProgress(fraction) {
      const clamped = Math.min(1, Math.max(0, fraction));
      fill.style.transform = `scaleX(${clamped})`;
      bar.setAttribute('aria-valuenow', String(Math.round(clamped * 100)));
    },
  };
}
