import type { AuthState } from '@archlin/platform/contracts';
import { redirect } from '@tanstack/react-router';
import { authStateFn } from '~/server/functions/auth';

// Setup and login screens are for visitors only: a signed-in user goes home, and each screen is sent to its sibling
// when the account state makes it meaningless.
export async function guardAuthScreen(screen: 'setup' | 'login'): Promise<AuthState> {
  const state = await authStateFn({ data: {} });
  if (state.authenticated) throw redirect({ to: '/' });
  if (screen === 'setup' && state.accountExists) throw redirect({ to: '/login' });
  if (screen === 'login' && !state.accountExists) throw redirect({ to: '/setup' });
  return state;
}
