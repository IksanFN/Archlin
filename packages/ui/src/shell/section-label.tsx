interface SectionLabelProps {
  children: string;
  count?: number;
}

function SectionLabel({ children, count }: SectionLabelProps) {
  return (
    <p className="flex items-baseline justify-between px-[14px] pt-7 pb-2.5 text-micro font-medium text-fg-muted">
      <span>{children}</span>
      {count === undefined ? null : <span className="font-mono">{count}</span>}
    </p>
  );
}

export { SectionLabel };
