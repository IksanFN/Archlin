import { NavItem } from '@archlin/ui/shell/nav-item';
import { ShieldIcon } from '@phosphor-icons/react/ssr';
import { useLocation } from '@tanstack/react-router';
import { messages } from '~/i18n/id';

// Only the one section that exists in M0 is listed; the other settings pages arrive with their milestones.
export function SettingsNav() {
  const { pathname } = useLocation();
  return (
    <nav aria-label={messages.settings.navLabel} className="shrink-0 px-4 pt-6 md:w-[240px] md:py-10">
      <p className="px-[14px] pb-4 text-title font-semibold text-fg">{messages.settings.navTitle}</p>
      <NavItem to="/settings/security" icon={ShieldIcon} label={messages.settings.security} selected={pathname === '/settings/security'} />
    </nav>
  );
}
