import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@archlin/ui/components/dropdown-menu';
import { toast } from '@archlin/ui/components/sonner';
import { useTheme } from '@archlin/ui/lib/theme';
import type { ThemePreference } from '@archlin/ui/lib/theme';
import { DesktopIcon, MoonIcon, SignOutIcon, SunIcon } from '@phosphor-icons/react/ssr';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { messages } from '~/i18n/id';
import { messageForError } from '~/lib/client-errors';
import { logoutFn } from '~/server/functions/auth';

const THEME_OPTIONS = [
  { value: 'system', label: messages.account.themeSystem, icon: DesktopIcon },
  { value: 'light', label: messages.account.themeLight, icon: SunIcon },
  { value: 'dark', label: messages.account.themeDark, icon: MoonIcon },
] as const;

function isThemePreference(value: string): value is ThemePreference {
  return THEME_OPTIONS.some((option) => option.value === value);
}

// Theme and sign-out live here because they must be reachable from every screen (spec 11).
export function AccountMenu({ displayName }: { displayName: string }) {
  const { preference, setPreference } = useTheme();
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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`${messages.account.menuLabel}: ${displayName}`}
          className="flex h-11 w-full items-center gap-3 rounded-md pr-3 pl-2.5 text-ui text-fg-secondary transition-colors duration-[120ms] ease-out hover:bg-overlay data-[state=open]:bg-overlay"
        >
          <span
            aria-hidden="true"
            className="flex size-8 shrink-0 items-center justify-center rounded-pill bg-surface-hover text-small font-medium text-fg-secondary"
          >
            {displayName.charAt(0).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1 truncate text-left">{displayName}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-[260px]">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{messages.account.theme}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={preference}
            onValueChange={(value) => {
              if (isThemePreference(value)) setPreference(value);
            }}
          >
            {THEME_OPTIONS.map(({ value, label, icon: OptionIcon }) => (
              <DropdownMenuRadioItem key={value} value={value}>
                <OptionIcon aria-hidden="true" size={16} className="text-fg-muted" />
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={signingOut} onSelect={() => void signOut()}>
          <SignOutIcon aria-hidden="true" size={16} className="text-fg-muted" />
          {messages.account.signOut}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
