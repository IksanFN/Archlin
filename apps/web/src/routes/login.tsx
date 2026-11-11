import { createFileRoute, Outlet } from '@tanstack/react-router';
import { z } from 'zod';
import { messages } from '~/i18n/id';
import { guardAuthScreen } from '~/lib/auth-guard';

// An unknown or tampered reason is dropped rather than rejected, so a bad link still opens the form.
const searchSchema = z.object({ alasan: z.enum(['sudah-disiapkan', 'verifikasi-habis']).optional().catch(undefined) });

// Guard and search contract shared by the password step and the totp step below it.
export const Route = createFileRoute('/login')({
  validateSearch: searchSchema,
  beforeLoad: async () => {
    await guardAuthScreen('login');
  },
  head: () => ({ meta: [{ title: `${messages.auth.login.title} · ${messages.appName}` }] }),
  component: Outlet,
});
