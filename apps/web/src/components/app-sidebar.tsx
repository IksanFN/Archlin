import { NavItem } from '@archlin/ui/shell/nav-item';
import { SectionLabel } from '@archlin/ui/shell/section-label';
import { Sidebar, SidebarHeader } from '@archlin/ui/shell/sidebar';
import { GearSixIcon, SunHorizonIcon } from '@phosphor-icons/react/ssr';
import { useLocation } from '@tanstack/react-router';
import { messages } from '~/i18n/id';
import { AccountMenu } from './account-menu';

// Inbox, search and favourites are not rendered: they do not exist until M1 and later (no dead navigation).
export function AppSidebar({ displayName }: { displayName: string }) {
  const { pathname } = useLocation();
  return (
    <Sidebar>
      <SidebarHeader name={messages.appName} hideLabel={messages.nav.hideSidebar} />
      <nav aria-label={messages.nav.label} className="flex min-h-0 flex-1 flex-col gap-1">
        <NavItem to="/" icon={SunHorizonIcon} label={messages.nav.today} selected={pathname === '/'} />
        <SectionLabel>{messages.nav.spaces}</SectionLabel>
        <p className="px-[14px] text-small text-fg-muted">{messages.nav.noSpaces}</p>
        <div className="mt-auto flex flex-col gap-1 pt-6">
          <NavItem
            to="/settings/security"
            icon={GearSixIcon}
            label={messages.nav.settings}
            selected={pathname.startsWith('/settings')}
          />
        </div>
      </nav>
      <AccountMenu displayName={displayName} />
    </Sidebar>
  );
}
