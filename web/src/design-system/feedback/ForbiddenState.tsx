import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../utils/cn";

export interface ForbiddenStateProps extends HTMLAttributes<HTMLDivElement> {
  title?: string;
  message?: string;
  /** Issue : retour zone autorisée (DO-005). */
  action?: ReactNode;
}

/**
 * ForbiddenState — droits insuffisants (DO-005, DO-031).
 * Distinct de Empty / Error / Coming soon.
 */
export function ForbiddenState({
  title = "Accès non autorisé",
  message = "Vous n’avez pas les droits nécessaires pour afficher ce contenu.",
  action,
  className,
  ...props
}: ForbiddenStateProps) {
  return (
    <div
      role="status"
      className={cn(
        "rounded-xl border border-amber/30 bg-amber/10 px-4 py-6 text-center",
        className,
      )}
      {...props}
    >
      <p className="text-sm font-semibold text-ink">{title}</p>
      <p className="mt-1 text-sm text-muted">{message}</p>
      {action ? <div className="no-print mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}
