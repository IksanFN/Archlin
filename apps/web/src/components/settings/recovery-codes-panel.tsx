import { Button } from '@archlin/ui/components/button';
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@archlin/ui/components/dialog';
import { toast } from '@archlin/ui/components/sonner';
import { CopyIcon, DownloadSimpleIcon } from '@phosphor-icons/react/ssr';
import { messages } from '~/i18n/id';

const copy = messages.settings.twoFactor;

function downloadAsText(codes: readonly string[]): void {
  const url = URL.createObjectURL(new Blob([`${codes.join('\n')}\n`], { type: 'text/plain' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = copy.downloadName;
  link.click();
  URL.revokeObjectURL(url);
}

// The codes live only in this component state: the server cannot show them again, and closing the dialog drops them.
export function RecoveryCodesPanel({ codes, onSaved }: { codes: readonly string[]; onSaved: () => void }) {
  async function copyAll(): Promise<void> {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      toast.success(copy.codesCopied);
    } catch {
      // The browser can refuse clipboard access; the download button is the fallback.
      toast.error(copy.copyFailed);
    }
  }

  return (
    <div className="grid gap-5">
      <DialogHeader>
        <DialogTitle>{copy.recoveryDialogTitle}</DialogTitle>
        <DialogDescription>{copy.recoveryDialogBody}</DialogDescription>
      </DialogHeader>
      <ul className="grid grid-cols-1 gap-x-6 gap-y-2 rounded-md bg-surface px-4 py-3 font-mono text-small text-fg sm:grid-cols-2">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-3">
        <Button variant="outline" size="row" leadingIcon={<CopyIcon aria-hidden="true" size={16} />} onClick={() => void copyAll()}>
          {copy.copyAll}
        </Button>
        <Button variant="outline" size="row" leadingIcon={<DownloadSimpleIcon aria-hidden="true" size={16} />} onClick={() => downloadAsText(codes)}>
          {copy.download}
        </Button>
      </div>
      <DialogFooter>
        <Button onClick={onSaved}>{copy.saved}</Button>
      </DialogFooter>
    </div>
  );
}
