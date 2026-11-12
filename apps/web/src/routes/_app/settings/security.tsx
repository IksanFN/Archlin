import { Button } from '@archlin/ui/components/button';
import { createFileRoute } from '@tanstack/react-router';
import { PasswordSection } from '~/components/settings/password-section';
import { ProfileSection } from '~/components/settings/profile-section';
import { ReauthProvider } from '~/components/settings/reauth-dialog';
import { SecurityEventsSection } from '~/components/settings/security-events-section';
import { SessionsSection } from '~/components/settings/sessions-section';
import { SettingsGroup, SettingsRow } from '~/components/settings/settings-row';
import { TwoFactorSection } from '~/components/settings/two-factor-section';
import { messages } from '~/i18n/id';
import { useSignOut } from '~/lib/use-sign-out';

export const Route = createFileRoute('/_app/settings/security')({
  head: () => ({ meta: [{ title: `${messages.settings.pageTitle} · ${messages.appName}` }] }),
  component: SecurityPage,
});

function SecurityPage() {
  const { viewer } = Route.useRouteContext();
  const { signOut, signingOut } = useSignOut();
  const device = messages.settings.device;
  return (
    <ReauthProvider totpEnabled={viewer.totpEnabled}>
      <div className="flex flex-col gap-10 px-4 py-6 md:p-12">
        <header className="flex max-w-[560px] flex-col gap-3">
          <h1 className="text-h3 text-fg md:text-h2">{messages.settings.pageTitle}</h1>
          <p className="text-body text-fg-muted">{messages.settings.pageDescription}</p>
        </header>
        <div className="max-w-[500px]">
          <ProfileSection viewer={viewer} />
          <PasswordSection viewer={viewer} />
          <TwoFactorSection viewer={viewer} />
          <SessionsSection viewer={viewer} />
          <SecurityEventsSection viewer={viewer} />
          <SettingsGroup label={device.group}>
            <SettingsRow title={device.title} description={device.body}>
              <Button variant="outline" size="row" loading={signingOut} onClick={() => void signOut()}>
                {device.action}
              </Button>
            </SettingsRow>
          </SettingsGroup>
        </div>
      </div>
    </ReauthProvider>
  );
}
