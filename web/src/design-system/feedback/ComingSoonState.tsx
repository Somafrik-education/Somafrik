import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../utils/cn";
import { Badge } from "../primitives/Badge/Badge";

export interface ComingSoonStateProps extends HTMLAttributes<HTMLDivElement> {
  title: string;
  description: string;
  /** Icône (ex. Lucide) — ReactNode pour rester découplé. */
  icon?: ReactNode;
  badge?: string;
}

/**
 * ComingSoonState — capacité non livrée (DO-005, DO-031).
 * Équivalent DS de `components/ui/PagePlaceholder` — coexistence.
 * ≠ EmptyState (pas de données) ≠ ForbiddenState.
 */
export function ComingSoonState({
  title,
  description,
  icon,
  badge = "Bientôt disponible",
  className,
  ...props
}: ComingSoonStateProps) {
  return (
    <div
      role="status"
      className={cn(
        "flex flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-white/70 px-6 py-16 text-center",
        className,
      )}
      {...props}
    >
      {icon ? (
        <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-brand-50 text-brand">
          {icon}
        </div>
      ) : null}
      <h3 className="text-lg font-black text-ink">{title}</h3>
      <p className="mt-2 max-w-md text-sm text-muted">{description}</p>
      <Badge tone="warning" className="mt-4">
        {badge}
      </Badge>
    </div>
  );
}
