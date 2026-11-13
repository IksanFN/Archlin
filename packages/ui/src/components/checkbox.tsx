import { Checkbox as CheckboxPrimitive } from 'radix-ui';
import { cn } from '../lib/utils';

interface CheckboxProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  id?: string;
  disabled?: boolean;
  className?: string;
}

function Checkbox({ checked, onCheckedChange, id, disabled, className }: CheckboxProps) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      id={id}
      checked={checked}
      onCheckedChange={(value) => {
        if (value === 'indeterminate') return;
        onCheckedChange(value);
      }}
      disabled={disabled}
      className={cn(
        'flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border-[1.5px] border-line-strong bg-transparent transition-[background-color,border-color] duration-[120ms] ease-out data-[state=checked]:border-inverse data-[state=checked]:bg-inverse disabled:bg-disabled-bg',
        className,
      )}
    >
      <CheckboxPrimitive.Indicator asChild>
        <svg viewBox="0 0 18 18" className="size-[18px] text-inverse-fg" aria-hidden="true">
          <path
            d="M3.5 9.5l3.5 3.5 7.5-8"
            pathLength={14}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="[stroke-dasharray:14] [stroke-dashoffset:0] starting:[stroke-dashoffset:14] transition-[stroke-dashoffset] duration-[160ms] ease-out motion-reduce:transition-none"
          />
        </svg>
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
