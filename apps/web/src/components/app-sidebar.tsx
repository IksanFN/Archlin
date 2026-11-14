import { NavItem } from '@archlin/ui/shell/nav-item';
import { ShellContext, Sidebar, SidebarHeader } from '@archlin/ui/shell/sidebar';
import { GearSixIcon, SunHorizonIcon } from '@phosphor-icons/react/ssr';
import { useLocation } from '@tanstack/react-router';
import { use, useCallback, useEffect } from 'react';
import { FavoritesSection } from '~/components/favorites-section';
import { SpaceTree } from '~/components/space-tree/space-tree';
import { messages } from '~/i18n/id';
import { subscribeTreeMutation } from '~/lib/tree-sync';
import { useAsyncData } from '~/lib/use-async-data';
import { favoritesFn } from '~/server/functions/tree';
import { AccountMenu } from './account-menu';

export function AppSidebar({ displayName }: { displayName: string }) {
  const { pathname } = useLocation();
  const { variant } = use(ShellContext);
  const loadFavorites = useCallback(() => favoritesFn({ data: {} }), []);
  const favorites = useAsyncData(loadFavorites);

  useEffect(() => subscribeTreeMutation(favorites.reload), [favorites.reload]);

  return (
    <Sidebar>
      <SidebarHeader name={messages.appName} hideLabel={messages.nav.hideSidebar} showLabel={messages.nav.showSidebar} />
      <nav aria-label={messages.nav.label} className="flex min-h-0 flex-1 flex-col gap-1">
        <NavItem to="/" icon={SunHorizonIcon} label={messages.nav.today} selected={pathname === '/'} />
        {variant === 'rail' ? null : (
          <>
            {favorites.state.status === 'ready' ? <FavoritesSection items={favorites.state.data} /> : null}
            <SpaceTree />
          </>
        )}
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
