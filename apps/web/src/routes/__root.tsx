import { Toaster } from '@archlin/ui/components/sonner';
import { TooltipProvider } from '@archlin/ui/components/tooltip';
import { themeBootScript } from '@archlin/ui/lib/theme';
import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router';
import appCss from '~/styles/app.css?url';

export const Route = createRootRoute({
  head: () => ({
    meta: [{ charSet: 'utf-8' }, { name: 'viewport', content: 'width=device-width, initial-scale=1' }, { title: 'Archlin' }],
    links: [{ rel: 'stylesheet', href: appCss }],
    // Router-managed scripts carry the request nonce, so this stays inside the CSP.
    scripts: [{ children: themeBootScript }],
  }),
  component: RootDocument,
});

function RootDocument() {
  return (
    // The boot script sets data-theme before hydration, so the attribute legitimately differs from the server markup.
    <html lang="id" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="min-h-dvh font-sans text-body antialiased">
        <TooltipProvider>
          <Outlet />
        </TooltipProvider>
        <Toaster />
        <Scripts />
      </body>
    </html>
  );
}
