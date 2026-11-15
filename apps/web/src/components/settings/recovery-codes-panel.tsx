import { Button } from '@archlin/ui/components/button';
import { CopyButton } from '@archlin/ui/components/copy-button';
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@archlin/ui/components/dialog';
import { DownloadSimpleIcon } from '@phosphor-icons/react/ssr';
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
        <CopyButton
          value={codes.join('\n')}
          labels={{ copy: copy.copyAll, copied: copy.codesCopied, failed: copy.copyFailed }}
          variant="outline"
          size="row"
        />
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
