import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../utils/cn";

export interface EmptyStateProps extends HTMLAttributes<HTMLDivElement> {
  title: string;
  description?: string;
  /** Prochaine action si autorisée (DO-006). */
  action?: ReactNode;
  /** Icône ou illustration optionnelle. */
  icon?: ReactNode;
}

/**
 * EmptyState — aucune donnée métier pertinente (DO-005).
 * Distinct de ComingSoonState (capacité non livrée) et ForbiddenState.
 */
export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      role="status"
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed border-line bg-slate-50 px-4 py-10 text-center",
        className,
      )}
      {...props}
    >
      {icon ? <div className="mb-3 text-muted">{icon}</div> : null}
      <p className="text-sm font-semibold text-ink">{title}</p>
      {description ? <p className="mt-1 max-w-md text-sm text-muted">{description}</p> : null}
      {action ? <div className="no-print mt-4">{action}</div> : null}
    </div>
  );
}
