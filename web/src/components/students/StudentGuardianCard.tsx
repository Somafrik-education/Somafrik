import type { StudentGuardianViewModel } from "../../lib/studentGuardianViewModel";
import { Card, SectionHeader, EmptyState } from "../../design-system";
import { StudentGuardianBadges } from "./StudentGuardianBadges";
import { cn } from "../../lib/utils";

interface StudentGuardianCardProps {
  guardian: StudentGuardianViewModel | null;
  title?: string;
  description?: string;
  emptyLabel?: string;
}

export function StudentGuardianCard({
  guardian,
  title = "Responsable principal",
  description = "Contact de référence pour le dossier élève.",
  emptyLabel = "Aucun responsable associé",
}: StudentGuardianCardProps) {
  if (!guardian) {
    return (
      <Card className="p-6">
        <SectionHeader title={title} description={description} />
        <EmptyState className="mt-6" title={emptyLabel} />
      </Card>
    );
  }

  return (
    <Card
      className={cn(
        "p-6",
        guardian.isPrimary && "border-brand/30 bg-brand-50/30",
      )}
    >
      <SectionHeader title={title} description={description} />

      <div className="mt-6 space-y-4">
        <div>
          <p className="text-xl font-bold text-ink">{guardian.displayName}</p>
          <p className="mt-1 text-sm text-muted">
            {guardian.relationshipLabel} · Priorité {guardian.priorityLabel}
          </p>
        </div>

        <StudentGuardianBadges badges={guardian.badges} />

        <dl className="grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
              Téléphone
            </dt>
            <dd className="mt-1 text-sm font-medium text-ink">
              {guardian.phoneLabel}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
              E-mail
            </dt>
            <dd className="mt-1 break-words text-sm font-medium text-ink">
              {guardian.emailLabel}
            </dd>
          </div>
        </dl>
      </div>
    </Card>
  );
}
