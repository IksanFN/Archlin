import { SkipLink } from '@archlin/ui/shell/skip-link';
import { Logo } from '@archlin/ui/shell/sidebar';
import { LockSimpleIcon } from '@phosphor-icons/react/ssr';
import type { ReactNode } from 'react';
import { messages } from '~/i18n/id';

interface AuthLayoutProps {
  title: string;
  description: string;
  children: ReactNode;
}

// One column, one question, one primary action per screen (MOCKUPS rule 2).
export function AuthLayout({ title, description, children }: AuthLayoutProps) {
  return (
    <div className="flex min-h-dvh flex-col">
      <SkipLink label={messages.common.skipToContent} targetId="konten" />
      <header className="flex h-[72px] shrink-0 items-center px-4 nav:px-10">
        <Logo name={messages.appName} />
      </header>
      <main id="konten" tabIndex={-1} className="flex flex-1 items-center justify-center px-4 py-8 outline-none">
        <div className="flex w-full max-w-[380px] flex-col gap-6">
          <div className="flex flex-col gap-2">
            <h1 className="text-auth-title text-fg">{title}</h1>
            <p className="text-ui text-fg-muted">{description}</p>
          </div>
          {children}
        </div>
      </main>
      <footer className="flex h-16 shrink-0 items-center justify-center gap-2 px-4 text-micro text-fg-muted">
        <LockSimpleIcon aria-hidden="true" size={12} />
        {messages.auth.footer}
      </footer>
    </div>
  );
}
