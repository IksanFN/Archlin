import { createFileRoute, Outlet } from '@tanstack/react-router';
import { SettingsNav } from '~/components/settings/settings-nav';

export const Route = createFileRoute('/_app/settings')({ component: SettingsLayout });

// Below 960px the settings nav sits above the content as a plain list (spec 11).
function SettingsLayout() {
  return (
    <div className="flex flex-1 flex-col md:flex-row">
      <SettingsNav />
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}
