import { Button } from '@archlin/ui/components/button';
import { EmptyState } from '@archlin/ui/shell/empty-state';
import { MagnifyingGlassIcon } from '@phosphor-icons/react/ssr';
import { Link } from '@tanstack/react-router';
import { messages } from '~/i18n/id';

export function NotFound() {
  return (
    <div className="flex min-h-dvh flex-1 items-center justify-center p-4">
      <EmptyState
        headingLevel={1}
        icon={MagnifyingGlassIcon}
        title={messages.errors.notFoundTitle}
        body={messages.errors.notFoundBody}
        actions={
          <Button variant="secondary" asChild>
            <Link to="/">{messages.errors.backToToday}</Link>
          </Button>
        }
        className="w-full max-w-md"
      />
    </div>
  );
}
