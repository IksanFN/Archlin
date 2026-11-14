import { browserStorage, countDrafts, flushActiveAutosaves, removeAllDrafts } from '@archlin/modules-knowledge/web';
import { Button } from '@archlin/ui/components/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@archlin/ui/components/dialog';
import { toast } from '@archlin/ui/components/sonner';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { messages } from '~/i18n/id';
import { logoutFn } from '~/server/functions/auth';
import { messageForError } from './client-errors';

function draftCount(): number {
  const storage = browserStorage();
  return storage === null ? 0 : countDrafts(storage);
}

// One sign-out path for the account menu and the device row in settings.
export function useSignOut(): { signOut: () => void; signingOut: boolean; dialog: ReactNode } {
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);
  const [draftWarning, setDraftWarning] = useState<number | null>(null);

  async function performSignOut(): Promise<void> {
    setSigningOut(true);
    try {
      await logoutFn({ data: {} });
      await navigate({ to: '/login' });
      // Cleared only after leaving the page: its unmount writes one last draft that must not outlive the session.
      const storage = browserStorage();
      if (storage !== null) removeAllDrafts(storage);
    } catch (error) {
      const presentation = messageForError(error);
      if (presentation.kind === 'redirect_login') await navigate({ to: '/login' });
      else if (presentation.kind === 'toast') toast.error(presentation.text);
    } finally {
      setSigningOut(false);
      setDraftWarning(null);
    }
  }

  async function startSignOut(): Promise<void> {
    if (signingOut) return;
    setSigningOut(true);
    // Save while the session is still valid; what cannot be saved stays as a draft and is reported below.
    await flushActiveAutosaves();
    const count = draftCount();
    if (count > 0) {
      setSigningOut(false);
      setDraftWarning(count);
    } else {
      await performSignOut();
    }
  }

  function signOut(): void {
    void startSignOut();
  }

  const dialog = (
    <Dialog
      open={draftWarning !== null}
      onOpenChange={(open) => {
        if (!open) setDraftWarning(null);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{messages.account.signOutDraftTitle(draftWarning ?? 0)}</DialogTitle>
          <DialogDescription>{messages.account.signOutDraftBody}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{messages.common.cancel}</Button>
          </DialogClose>
          <Button variant="danger" loading={signingOut} onClick={() => void performSignOut()}>
            {messages.account.signOutAndDelete}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { signOut, signingOut, dialog };
}
