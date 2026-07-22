import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../utils/cn";

export interface ErrorStateProps extends HTMLAttributes<HTMLDivElement> {
  title?: string;
  message: string;
  /** Retry / repli (DO-005). */
  action?: ReactNode;
}

/**
 * ErrorState — échec de chargement / opération (DO-005).
 * Distinct de ForbiddenState et EmptyState.
 */
export function ErrorState({
  title = "Une erreur est survenue",
  message,
  action,
  className,
  ...props
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        "rounded-xl border border-danger/30 bg-danger/10 px-4 py-6 text-center",
        className,
      )}
      {...props}
    >
      <p className="text-sm font-semibold text-ink">{title}</p>
      <p className="mt-1 text-sm text-danger">{message}</p>
      {action ? <div className="no-print mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}
