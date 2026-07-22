import { forwardRef, type SelectHTMLAttributes } from "react";
import { cn } from "../../utils/cn";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options?: SelectOption[];
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, options = [], disabled, children, ...props }, ref) => (
    <select
      ref={ref}
      disabled={disabled}
      aria-disabled={disabled || undefined}
      className={cn("input-base", disabled && "cursor-not-allowed opacity-50", className)}
      {...props}
    >
      {children ??
        options.map((opt) => (
          <option key={opt.value} value={opt.value} disabled={opt.disabled}>
            {opt.label}
          </option>
        ))}
    </select>
  ),
);

Select.displayName = "Select";
