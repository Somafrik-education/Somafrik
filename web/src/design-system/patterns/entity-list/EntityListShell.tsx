import type { ReactNode } from "react";
import { ListLayout } from "../../layout/ListLayout";
import { cn } from "../../utils/cn";

/**
 * EntityListShell — chrome liste générique (D2.7).
 * Compose `ListLayout` (P-002) sans logique métier ni entité.
 *
 * Slots :
 * - orientation (retour / breadcrumb léger)
 * - title / description
 * - primaryActions / secondaryActions
 * - filters
 * - alerts (bannières non-KPI)
 * - children → contenu tableau
 */
export interface EntityListShellProps {
  title: ReactNode;
  description?: ReactNode;
  /** Lien ou fil d’Ariane au-dessus du header (ex. retour classes). */
  orientation?: ReactNode;
  alerts?: ReactNode;
  filters?: ReactNode;
  primaryActions?: ReactNode;
  secondaryActions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Niveau de titre — défaut h2 (aligné SectionHeader legacy). */
  headingLevel?: "h1" | "h2" | "h3";
}

export function EntityListShell({
  title,
  description,
  orientation,
  alerts,
  filters,
  primaryActions,
  secondaryActions,
  children,
  className,
  headingLevel = "h2",
}: EntityListShellProps) {
  const Heading = headingLevel;

  return (
    <div className={cn("space-y-3", className)}>
      {orientation ? (
        <nav aria-label="Orientation" className="text-sm">
          {orientation}
        </nav>
      ) : null}
      <ListLayout
        header={<Heading className="text-lg font-bold text-ink">{title}</Heading>}
        description={description}
        primaryActions={primaryActions}
        secondaryActions={secondaryActions}
        filters={filters}
        content={
          <div className="space-y-4">
            {alerts}
            {children}
          </div>
        }
      />
    </div>
  );
}
