import { IMAGE_MIMES, isAllowedImageSrc } from '@archlin/modules-knowledge/shared';
import { Button } from '@archlin/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@archlin/ui/components/dialog';
import { FormField } from '@archlin/ui/components/form-field';
import { Input } from '@archlin/ui/components/input';
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { EditorLabels } from './labels';

const LOAD_TIMEOUT_MS = 10_000;
const IMAGE_ACCEPT = IMAGE_MIMES.join(',');

export function loadImageSize(
  src: string,
  timeoutMs: number,
  createImage: () => HTMLImageElement = () => new Image(),
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = createImage();
    let settled = false;

    const timer = setTimeout(() => {
      finish(() => reject(new Error('timeout')));
    }, timeoutMs);

    function finish(action: () => void): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      action();
    }

    image.onload = () => {
      finish(() => resolve({ width: image.naturalWidth, height: image.naturalHeight }));
    };
    image.onerror = () => {
      finish(() => reject(new Error('load failed')));
    };
    // Referrer is stripped so a private note URL never leaks to the image host.
    image.referrerPolicy = 'no-referrer';
    image.src = src;
  });
}

function ImageDialogForm({
  onInsert,
  onUpload,
  onOpenChange,
  labels,
}: {
  onInsert: (attrs: { src: string; alt: string; width: number; height: number }) => void;
  onUpload?: ((file: File) => void) | undefined;
  onOpenChange: (open: boolean) => void;
  labels: EditorLabels;
}) {
  const [url, setUrl] = useState('');
  const [alt, setAlt] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [invalidAttempt, setInvalidAttempt] = useState(0);
  const [loading, setLoading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (loading) return;
    const src = url.trim();
    if (!isAllowedImageSrc(src, null)) {
      setError(labels.image.urlInvalid);
      setInvalidAttempt((current) => current + 1);
      return;
    }
    setError(undefined);
    setLoading(true);
    try {
      const size = await loadImageSize(src, LOAD_TIMEOUT_MS);
      onInsert({ src, alt: alt.trim(), width: size.width, height: size.height });
      onOpenChange(false);
    } catch {
      setError(labels.image.loadFailed);
      setInvalidAttempt((current) => current + 1);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="grid gap-5">
      <DialogHeader>
        <DialogTitle>{labels.image.title}</DialogTitle>
      </DialogHeader>
      <FormField label={labels.image.url} error={error} invalidAttempt={invalidAttempt}>
        {(control) => (
          <Input
            {...control}
            type="text"
            inputMode="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
        )}
      </FormField>
      <FormField label={labels.image.alt} helper={labels.image.altHelper}>
        {(control) => <Input {...control} value={alt} onChange={(event) => setAlt(event.target.value)} />}
      </FormField>
      <DialogFooter>
        {onUpload === undefined ? null : (
          <>
            <input
              ref={fileInput}
              type="file"
              accept={IMAGE_ACCEPT}
              tabIndex={-1}
              aria-hidden="true"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file === undefined) return;
                onUpload(file);
                onOpenChange(false);
              }}
            />
            <Button type="button" variant="secondary" onClick={() => fileInput.current?.click()}>
              {labels.image.upload}
            </Button>
          </>
        )}
        <Button type="submit" loading={loading}>
          {labels.image.insert}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function ImageDialog({
  open,
  onOpenChange,
  onInsert,
  onUpload,
  labels,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInsert: (attrs: { src: string; alt: string; width: number; height: number }) => void;
  // Present only where a page can take files; it adds an upload-from-device button next to the URL field.
  onUpload?: ((file: File) => void) | undefined;
  labels: EditorLabels;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>{open ? <ImageDialogForm onInsert={onInsert} onUpload={onUpload} onOpenChange={onOpenChange} labels={labels} /> : null}</DialogContent>
    </Dialog>
  );
}
