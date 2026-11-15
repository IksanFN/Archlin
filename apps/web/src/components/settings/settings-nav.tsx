import { NavItem } from '@archlin/ui/shell/nav-item';
import { NotebookIcon, ShieldIcon, TrashIcon } from '@phosphor-icons/react/ssr';
import { useLocation } from '@tanstack/react-router';
import { messages } from '~/i18n/id';

export function SettingsNav() {
  const { pathname } = useLocation();
  return (
    <nav aria-label={messages.settings.navLabel} className="shrink-0 px-4 pt-6 md:w-[240px] md:py-10">
      <p className="px-[14px] pb-4 text-title font-semibold text-fg">{messages.settings.navTitle}</p>
      <NavItem to="/settings/security" icon={ShieldIcon} label={messages.settings.security} selected={pathname === '/settings/security'} />
      <NavItem
        to="/settings/note-types"
        icon={NotebookIcon}
        label={messages.noteTypes.nav}
        selected={pathname.startsWith('/settings/note-types')}
      />
      <NavItem to="/settings/trash" icon={TrashIcon} label={messages.settings.trash.nav} selected={pathname === '/settings/trash'} />
    </nav>
  );
}
