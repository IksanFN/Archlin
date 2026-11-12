import { RECOVERY_CODE_COUNT } from '@archlin/platform/contracts';
import type { Viewer } from '@archlin/platform/contracts';
import { Button } from '@archlin/ui/components/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@archlin/ui/components/dialog';
import { InputOTP, InputOTPGroup, InputOTPSlot, REGEXP_ONLY_DIGITS } from '@archlin/ui/components/input-otp';
import { Label } from '@archlin/ui/components/label';
import { toast } from '@archlin/ui/components/sonner';
import { cn } from '@archlin/ui/lib/utils';
import { CopyIcon } from '@phosphor-icons/react/ssr';
import { useRouter } from '@tanstack/react-router';
import { useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { messages } from '~/i18n/id';
import { messageForError } from '~/lib/client-errors';
import { formatDate } from '~/lib/format-time';
import { AppError } from '~/server/errors';
import { beginTotpFn, confirmTotpFn, disableTotpFn, regenerateRecoveryCodesFn } from '~/server/functions/account';
import { RecoveryCodesPanel } from './recovery-codes-panel';
import { useReauth } from './reauth-dialog';
import { SettingsGroup, SettingsRow } from './settings-row';

const copy = messages.settings.twoFactor;

type Enrollment = { secret: string; qrSvg: string };

// Each flow opens with its data already in hand: the server call (and any re-authentication it needs) happens in the
// button handler, so a cancelled confirmation never leaves an empty dialog behind.
type Flow =
  | { kind: 'closed' }
  | { kind: 'enroll'; enrollment: Enrollment }
  | { kind: 'disable' }
  | { kind: 'recovery'; codes: readonly string[] };

function reportFailure(failure: unknown): void {
  const presentation = messageForError(failure);
  if (presentation.kind === 'toast') toast.error(presentation.text);
}

export function TwoFactorSection({ viewer }: { viewer: Viewer }) {
  const router = useRouter();
  const reauth = useReauth();
  const [flow, setFlow] = useState<Flow>({ kind: 'closed' });
  const [busy, setBusy] = useState<'enroll' | 'regenerate' | null>(null);
  const lowCodes = viewer.recoveryCodesRemaining <= 3;
  const close = () => setFlow({ kind: 'closed' });

  async function startEnrollment(): Promise<void> {
    setBusy('enroll');
    try {
      await reauth(async () => {
        const begun = await beginTotpFn({ data: {} });
        setFlow({ kind: 'enroll', enrollment: { secret: begun.secret, qrSvg: begun.qrSvg } });
      });
    } catch (failure) {
      reportFailure(failure);
    } finally {
      setBusy(null);
    }
  }

  async function regenerate(): Promise<void> {
    setBusy('regenerate');
    try {
      await reauth(async () => {
        const regenerated = await regenerateRecoveryCodesFn({ data: {} });
        setFlow({ kind: 'recovery', codes: regenerated.recoveryCodes });
        await router.invalidate();
      });
    } catch (failure) {
      reportFailure(failure);
    } finally {
      setBusy(null);
    }
  }

  return (
    <SettingsGroup label={copy.group}>
      {viewer.totpEnabled ? (
        <>
          <SettingsRow
            title={copy.appTitle}
            description={
              <span className="text-success">
                {viewer.totpEnabledAt === null ? copy.onNoDate : copy.on(formatDate(new Date(viewer.totpEnabledAt), viewer.timezone))}
              </span>
            }
          >
            <Button variant="outline" size="row" onClick={() => setFlow({ kind: 'disable' })}>
              {copy.disable}
            </Button>
          </SettingsRow>
          <SettingsRow
            title={copy.recoveryTitle}
            description={
              <span className={cn(lowCodes && 'text-attention')}>
                {copy.recoveryRemaining(viewer.recoveryCodesRemaining, RECOVERY_CODE_COUNT)}
              </span>
            }
          >
            <Button variant="outline" size="row" loading={busy === 'regenerate'} onClick={() => void regenerate()}>
              {copy.regenerate}
            </Button>
          </SettingsRow>
        </>
      ) : (
        <SettingsRow title={copy.appTitle} description={<span className="text-attention">{copy.off}</span>}>
          <Button variant="outline" size="row" loading={busy === 'enroll'} onClick={() => void startEnrollment()}>
            {copy.enable}
          </Button>
        </SettingsRow>
      )}

      <Dialog open={flow.kind !== 'closed'} onOpenChange={(open) => (open ? undefined : close())}>
        {flow.kind === 'enroll' ? <EnrollDialog enrollment={flow.enrollment} onRecoveryCodes={(codes) => setFlow({ kind: 'recovery', codes })} /> : null}
        {flow.kind === 'disable' ? <DisableDialog onClose={close} /> : null}
        {flow.kind === 'recovery' ? <RecoveryDialog codes={flow.codes} onClose={close} /> : null}
      </Dialog>
    </SettingsGroup>
  );
}

// Escape and outside clicks are blocked: the codes are shown once, so closing has to be a deliberate button press.
function RecoveryDialog({ codes, onClose }: { codes: readonly string[]; onClose: () => void }) {
  return (
    <DialogContent onEscapeKeyDown={(event) => event.preventDefault()} onInteractOutside={(event) => event.preventDefault()}>
      <RecoveryCodesPanel codes={codes} onSaved={onClose} />
    </DialogContent>
  );
}

function EnrollDialog({ enrollment, onRecoveryCodes }: { enrollment: Enrollment; onRecoveryCodes: (codes: readonly string[]) => void }) {
  const router = useRouter();
  const reauth = useReauth();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const codeId = useId();

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting.current || code.length !== 6) return;
    submitting.current = true;
    setPending(true);
    setError(undefined);
    try {
      await reauth(async () => {
        const confirmed = await confirmTotpFn({ data: { code } });
        onRecoveryCodes(confirmed.recoveryCodes);
        await router.invalidate();
      });
    } catch (failure) {
      if (failure instanceof AppError && failure.code === 'invalid_code') {
        setError(copy.invalidCode);
        setCode('');
      } else {
        reportFailure(failure);
      }
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  async function copySecret(): Promise<void> {
    try {
      await navigator.clipboard.writeText(enrollment.secret);
      toast.success(copy.secretCopied);
    } catch {
      // The browser can refuse clipboard access; the secret stays selectable on screen.
      toast.error(copy.copyFailed);
    }
  }

  return (
    <DialogContent>
      <form onSubmit={(event) => void submit(event)} className="grid gap-5">
        <DialogHeader>
          <DialogTitle>{copy.enrollTitle}</DialogTitle>
          <DialogDescription>{copy.enrollBody}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4">
          <img
            src={`data:image/svg+xml;utf8,${encodeURIComponent(enrollment.qrSvg)}`}
            alt={copy.qrAlt}
            width={192}
            height={192}
            className="size-48 rounded-md"
          />
          <div className="flex w-full flex-col gap-1.5">
            <p className="text-micro text-fg-muted">{copy.secretLabel}</p>
            <div className="flex items-center justify-between gap-2 rounded-md bg-surface px-3 py-2">
              <code className="min-w-0 break-all font-mono text-small text-fg">{enrollment.secret}</code>
              <Button variant="icon" size="icon-sm" aria-label={copy.copySecret} onClick={() => void copySecret()}>
                <CopyIcon aria-hidden="true" size={16} />
              </Button>
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={codeId}>{copy.codeLabel}</Label>
          <InputOTP
            id={codeId}
            maxLength={6}
            value={code}
            onChange={setCode}
            pattern={REGEXP_ONLY_DIGITS}
            inputMode="numeric"
            autoComplete="one-time-code"
            aria-invalid={error === undefined ? undefined : true}
            pasteTransformer={(pasted) => pasted.replace(/\s+/g, '')}
          >
            <InputOTPGroup>
              {Array.from({ length: 6 }, (_, index) => (
                <InputOTPSlot key={index} index={index} />
              ))}
            </InputOTPGroup>
          </InputOTP>
          {error === undefined ? null : (
            <p role="alert" className="text-micro text-danger">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{messages.common.cancel}</Button>
          </DialogClose>
          <Button type="submit" loading={pending} disabled={code.length !== 6}>
            {copy.confirm}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function DisableDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const reauth = useReauth();
  const [pending, setPending] = useState(false);

  async function disable(): Promise<void> {
    setPending(true);
    try {
      await reauth(async () => {
        await disableTotpFn({ data: {} });
        toast.success(copy.disabled);
        onClose();
        await router.invalidate();
      });
    } catch (failure) {
      reportFailure(failure);
    } finally {
      setPending(false);
    }
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{copy.disableTitle}</DialogTitle>
        <DialogDescription>{copy.disableBody}</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline">{messages.common.cancel}</Button>
        </DialogClose>
        <Button variant="danger" loading={pending} onClick={() => void disable()}>
          {copy.disable}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
