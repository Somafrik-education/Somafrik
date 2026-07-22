import type { HTMLAttributes } from "react";
import { cn } from "../../utils/cn";

export interface SpinnerProps extends HTMLAttributes<HTMLDivElement> {
  size?: "sm" | "md" | "lg";
  /** Libellé annoncé aux lecteurs d’écran. */
  label?: string;
}

const SIZE: Record<NonNullable<SpinnerProps["size"]>, string> = {
  sm: "h-4 w-4 border-2",
  md: "h-6 w-6 border-2",
  lg: "h-8 w-8 border-[3px]",
};

export function Spinner({
  className,
  size = "md",
  label = "Chargement",
  ...props
}: SpinnerProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      className={cn("inline-flex items-center justify-center", className)}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          "animate-spin rounded-full border-brand border-t-transparent",
          SIZE[size],
        )}
      />
      <span className="sr-only">{label}</span>
    </div>
  );
}
