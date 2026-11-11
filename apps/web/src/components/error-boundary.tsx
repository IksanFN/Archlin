import { Button } from '@archlin/ui/components/button';
import { EmptyState } from '@archlin/ui/shell/empty-state';
import { WarningIcon } from '@phosphor-icons/react/ssr';
import type { ErrorComponentProps } from '@tanstack/react-router';
import { messages } from '~/i18n/id';
import { AppError } from '~/server/errors';

export function ErrorBoundary({ error }: ErrorComponentProps) {
  const requestId = error instanceof AppError ? error.requestId : null;
  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <EmptyState
        headingLevel={1}
        icon={WarningIcon}
        title={messages.errors.pageTitle}
        body={messages.errors.pageBody(requestId)}
        actions={<Button onClick={() => window.location.reload()}>{messages.errors.reload}</Button>}
        className="w-full max-w-md"
      />
    </div>
  );
}
