interface SkipLinkProps {
  label: string;
  targetId: string;
}

// First tab stop on every page; it stays invisible until focused.
function SkipLink({ label, targetId }: SkipLinkProps) {
  return (
    <a
      href={`#${targetId}`}
      className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:rounded-pill focus:bg-inverse focus:px-4 focus:py-2 focus:text-small focus:font-medium focus:text-inverse-fg"
    >
      {label}
    </a>
  );
}

export { SkipLink };
