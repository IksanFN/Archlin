import type { InboundLink } from '@archlin/platform/contracts';
import { FileTextIcon } from '@phosphor-icons/react/ssr';
import type { MouseEvent } from 'react';

export interface MentionedInLabels {
  title: string;
  empty: string;
}

export function MentionedIn({
  backlinks,
  labels,
  navigate,
}: {
  backlinks: readonly InboundLink[];
  labels: MentionedInLabels;
  navigate: (href: string) => void;
}) {
  // aria-label instead of aria-labelledby: axe crashes Playwright Firefox on the labelledby pattern.
  return (
    <section aria-label={labels.title} className="mt-16 border-t border-line-subtle pt-6">
      <div className="flex items-baseline gap-2">
        <h2 className="text-small font-medium text-fg">{labels.title}</h2>
        <span className="font-mono text-micro text-fg-muted">{backlinks.length}</span>
      </div>
      {backlinks.length === 0 ? (
        <p className="mt-3 text-small text-fg-muted">{labels.empty}</p>
      ) : (
        <ul className="mt-4 grid gap-4">
          {backlinks.map((link) => {
            const href = `/s/${link.spaceSlug}/p/${link.sourceId}`;
            return (
              <li key={`${link.sourceId}:${link.kind}`}>
                <a
                  href={href}
                  className="block rounded-sm fine-hover:text-fg"
                  onClick={(event: MouseEvent<HTMLAnchorElement>) => {
                    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
                    event.preventDefault();
                    navigate(href);
                  }}
                >
                  <span className="flex items-center gap-2 text-body text-fg">
                    {link.icon === null ? (
                      <FileTextIcon aria-hidden="true" size={14} className="shrink-0 text-fg-muted" />
                    ) : (
                      <span aria-hidden="true" className="w-3.5 shrink-0 text-center text-[13px] leading-none">
                        {link.icon}
                      </span>
                    )}
                    <span className="min-w-0 truncate">{link.title}</span>
                  </span>
                  {link.snippet === '' ? null : (
                    <span className="mt-1 line-clamp-2 block text-small text-fg-muted">{link.snippet}</span>
                  )}
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
