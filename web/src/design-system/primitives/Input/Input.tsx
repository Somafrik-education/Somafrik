import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "../../utils/cn";

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", disabled, ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      disabled={disabled}
      aria-disabled={disabled || undefined}
      className={cn("input-base", disabled && "cursor-not-allowed opacity-50", className)}
      {...props}
    />
  ),
);

Input.displayName = "Input";
