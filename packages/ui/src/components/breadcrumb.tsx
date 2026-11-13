import { CaretRightIcon } from '@phosphor-icons/react/ssr';
import { Link } from '@tanstack/react-router';
import { cn } from '../lib/utils';

interface BreadcrumbItem {
  label: string;
  href: string;
}

interface BreadcrumbProps {
  items: readonly BreadcrumbItem[];
  current: string;
  label: string;
  className?: string;
}

function Breadcrumb({ items, current, label, className }: BreadcrumbProps) {
  return (
    <nav data-slot="breadcrumb" aria-label={label} className={className}>
      <ol className="flex min-w-0 items-center gap-1 text-small">
        {items.map((item) => (
          <li key={item.href} className="flex min-w-0 items-center gap-1">
            <Link to={item.href} className="max-w-[16ch] truncate text-fg-muted transition-colors duration-[120ms] ease-out hover:text-fg">
              {item.label}
            </Link>
            <CaretRightIcon aria-hidden="true" size={14} className="shrink-0 text-fg-disabled" />
          </li>
        ))}
        <li aria-current="page" className={cn('max-w-[16ch] truncate font-medium text-fg')}>
          {current}
        </li>
      </ol>
    </nav>
  );
}

export { Breadcrumb };
