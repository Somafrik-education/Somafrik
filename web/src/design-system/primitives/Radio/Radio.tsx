import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "../../utils/cn";

export interface RadioProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: string;
}

export const Radio = forwardRef<HTMLInputElement, RadioProps>(
  ({ className, label, id, disabled, ...props }, ref) => {
    const input = (
      <input
        ref={ref}
        id={id}
        type="radio"
        disabled={disabled}
        aria-disabled={disabled || undefined}
        className={cn(
          "h-4 w-4 border-line text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 disabled:cursor-not-allowed disabled:opacity-50",
          !label && className,
        )}
        {...props}
      />
    );

    if (!label) return input;

    return (
      <label
        htmlFor={id}
        className={cn(
          "inline-flex min-h-10 items-center gap-2 text-sm text-ink",
          disabled && "cursor-not-allowed opacity-50",
          className,
        )}
      >
        {input}
        <span>{label}</span>
      </label>
    );
  },
);

Radio.displayName = "Radio";
