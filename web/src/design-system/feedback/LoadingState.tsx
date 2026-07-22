import type { HTMLAttributes } from "react";
import { cn } from "../utils/cn";
import { Spinner } from "../primitives/Spinner/Spinner";

export interface LoadingStateProps extends HTMLAttributes<HTMLDivElement> {
  /** Message affiché (FR). */
  message?: string;
  /** Libellé sr-only du Spinner. */
  label?: string;
}

/**
 * LoadingState — chargement explicite (DO-005, DO-021).
 * À utiliser dans le contenu ; le shell / orientation reste hors composant.
 */
export function LoadingState({
  message = "Chargement…",
  label = "Chargement",
  className,
  ...props
}: LoadingStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl px-4 py-10 text-center",
        className,
      )}
      {...props}
    >
      <Spinner size="md" label={label} />
      <p className="text-sm text-muted">{message}</p>
    </div>
  );
}
