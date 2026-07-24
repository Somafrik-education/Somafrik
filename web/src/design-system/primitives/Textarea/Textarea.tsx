import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "../../utils/cn";

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, disabled, rows = 4, ...props }, ref) => (
    <textarea
      ref={ref}
      rows={rows}
      disabled={disabled}
      aria-disabled={disabled || undefined}
      className={cn(
        "input-base min-h-[5.5rem] resize-y",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
      {...props}
    />
  ),
);

Textarea.displayName = "Textarea";
