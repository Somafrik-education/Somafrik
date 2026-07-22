import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "../../utils/cn";

export interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  label?: string;
}

/**
 * Switch — interrupteur accessible (role=switch).
 * Contrôlé : `checked` + `onCheckedChange`.
 */
export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(
  (
    {
      className,
      checked,
      onCheckedChange,
      disabled,
      label,
      id,
      type = "button",
      ...props
    },
    ref,
  ) => {
    const control = (
      <button
        ref={ref}
        id={id}
        type={type}
        role="switch"
        aria-checked={checked}
        aria-disabled={disabled || undefined}
        disabled={disabled}
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-transparent transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 disabled:cursor-not-allowed disabled:opacity-50",
          checked ? "bg-brand" : "bg-slate-200",
          !label && className,
        )}
        onClick={() => {
          if (!disabled) onCheckedChange?.(!checked);
        }}
        {...props}
      >
        <span
          aria-hidden
          className={cn(
            "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition",
            checked ? "translate-x-5" : "translate-x-0.5",
          )}
        />
      </button>
    );

    if (!label) return control;

    return (
      <label
        htmlFor={id}
        className={cn(
          "inline-flex min-h-10 items-center gap-2 text-sm text-ink",
          disabled && "cursor-not-allowed opacity-50",
          className,
        )}
      >
        {control}
        <span>{label}</span>
      </label>
    );
  },
);

Switch.displayName = "Switch";
