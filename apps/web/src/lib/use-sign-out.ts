import { toast } from '@archlin/ui/components/sonner';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { logoutFn } from '~/server/functions/auth';
import { messageForError } from './client-errors';

// One sign-out path for the account menu and the device row in settings.
export function useSignOut(): { signOut: () => Promise<void>; signingOut: boolean } {
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut(): Promise<void> {
    setSigningOut(true);
    try {
      await logoutFn({ data: {} });
      await navigate({ to: '/login' });
    } catch (error) {
      const presentation = messageForError(error);
      if (presentation.kind === 'redirect_login') await navigate({ to: '/login' });
      else if (presentation.kind === 'toast') toast.error(presentation.text);
    } finally {
      setSigningOut(false);
    }
  }

  return { signOut, signingOut };
}
