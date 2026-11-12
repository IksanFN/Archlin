import { CircleNotchIcon } from '@phosphor-icons/react/ssr';
import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import { useLayoutEffect, useRef } from 'react';
import type { ComponentProps, MouseEvent, ReactNode } from 'react';
import { cn } from '../lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-pill text-small font-medium whitespace-nowrap transition-[color,background-color,border-color,transform] duration-[120ms] ease-out enabled:active:scale-[0.97] disabled:bg-disabled-bg disabled:text-fg-disabled [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'h-10 px-[18px] bg-inverse text-inverse-fg hover:bg-inverse-hover active:bg-inverse-pressed',
        secondary: 'h-10 px-[18px] bg-surface-raised text-fg hover:bg-surface-hover active:bg-surface-pressed',
        outline:
          'h-10 px-[18px] border border-line-strong text-fg hover:bg-overlay active:bg-surface-hover disabled:border-line disabled:bg-transparent',
        ghost: 'h-8 px-3 text-nav text-fg-secondary hover:bg-overlay active:bg-surface-hover disabled:bg-transparent',
        danger: 'h-10 px-[18px] bg-danger text-on-danger hover:shadow-[inset_0_0_0_999px_var(--grok-color-overlay)]',
        icon: 'size-10 bg-surface-raised text-fg hover:bg-surface-hover',
      },
      size: {
        default: '',
        auth: 'h-12 w-full px-[18px] text-ui',
        row: 'h-[34px] px-3.5 text-[13px]',
        'icon-sm': 'size-8 px-0',
      },
    },
    defaultVariants: { variant: 'primary', size: 'default' },
  },
);

type ButtonBaseProps = Omit<ComponentProps<'button'>, 'aria-label'> &
  Pick<VariantProps<typeof buttonVariants>, 'size'> & {
    asChild?: boolean;
    loading?: boolean;
    leadingIcon?: ReactNode;
  };

// An icon-only button has no visible text, so the type refuses one without an accessible name.
export type ButtonProps = ButtonBaseProps &
  (
    | { variant: 'icon'; 'aria-label': string }
    | { variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger'; 'aria-label'?: string }
  );

function Button({
  className,
  variant = 'primary',
  size,
  asChild = false,
  loading = false,
  leadingIcon,
  children,
  onClick,
  type,
  ...props
}: ButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const settledWidth = useRef(0);

  // The label stays while the spinner swaps in, so the width is pinned to what the idle button measured.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    if (loading) {
      el.style.minWidth = `${settledWidth.current}px`;
    } else {
      settledWidth.current = el.offsetWidth;
      el.style.minWidth = '';
    }
  });

  const handleClick = (event: MouseEvent<HTMLButtonElement>): void => {
    // A busy button stays focusable (no disabled attribute) but ignores repeat clicks and submits.
    if (loading) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };

  const classes = cn(buttonVariants({ variant, size }), className);

  if (asChild) {
    return (
      <Slot.Root data-slot="button" className={classes} {...props}>
        {children}
      </Slot.Root>
    );
  }

  return (
    <button
      ref={ref}
      data-slot="button"
      type={type ?? 'button'}
      className={classes}
      aria-busy={loading || undefined}
      onClick={handleClick}
      {...props}
    >
      {loading ? <CircleNotchIcon aria-hidden="true" size={16} className="animate-spin" /> : leadingIcon}
      {children}
    </button>
  );
}

export { Button, buttonVariants };
