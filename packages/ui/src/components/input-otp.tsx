import { OTPInput, OTPInputContext } from 'input-otp';
import { useContext } from 'react';
import type { ComponentProps } from 'react';
import { cn } from '../lib/utils';

function InputOTP({ className, containerClassName, ...props }: ComponentProps<typeof OTPInput>) {
  return (
    <OTPInput
      data-slot="input-otp"
      containerClassName={cn('flex w-full items-center has-[:disabled]:cursor-not-allowed', containerClassName)}
      className={cn('disabled:cursor-not-allowed', className)}
      {...props}
    />
  );
}

function InputOTPGroup({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="input-otp-group" className={cn('flex w-full items-center gap-2.5', className)} {...props} />;
}

// Each digit is its own bordered box; the active one borrows the focus colour instead of a ring.
function InputOTPSlot({ index, className, ...props }: ComponentProps<'div'> & { index: number }) {
  const { slots } = useContext(OTPInputContext);
  const slot = slots[index];
  const char = slot?.char ?? null;
  const isActive = slot?.isActive === true;
  return (
    <div
      data-slot="input-otp-slot"
      data-active={isActive}
      className={cn(
        'relative flex h-15 min-w-0 max-w-[55px] flex-1 items-center justify-center rounded-md border border-line-subtle bg-overlay font-mono text-[26px] font-medium text-fg',
        'data-[active=true]:border-focus data-[active=true]:outline-2 data-[active=true]:outline-focus',
        className,
      )}
      {...props}
    >
      {char}
      {slot?.hasFakeCaret === true ? (
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="h-7 w-px animate-pulse bg-fg" />
        </span>
      ) : null}
    </div>
  );
}

export { REGEXP_ONLY_DIGITS } from 'input-otp';
export { InputOTP, InputOTPGroup, InputOTPSlot };
