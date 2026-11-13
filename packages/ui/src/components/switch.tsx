import { Switch as SwitchPrimitive } from 'radix-ui';
import { cn } from '../lib/utils';

interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  'aria-label'?: string;
  disabled?: boolean;
  className?: string;
}

function Switch({ checked, onCheckedChange, disabled, className, 'aria-label': ariaLabel }: SwitchProps) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      {...(ariaLabel === undefined ? {} : { 'aria-label': ariaLabel })}
      className={cn(
        'relative h-5 w-9 shrink-0 rounded-pill bg-surface-hover transition-colors duration-[120ms] ease-out data-[state=checked]:bg-inverse disabled:bg-disabled-bg',
        className,
      )}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none absolute top-0.5 left-0.5 block size-4 rounded-pill bg-white transition-transform duration-[150ms] ease-out data-[state=checked]:translate-x-4 data-[state=checked]:bg-inverse-fg motion-reduce:transition-none" />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
