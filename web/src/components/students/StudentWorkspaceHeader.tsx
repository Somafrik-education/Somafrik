import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import type { StudentWorkspaceViewModel } from "../../lib/studentWorkspaceViewModel";
import { Badge, Card } from "../../design-system";
import { StatusBadge } from "../ui/Badge";

interface StudentWorkspaceHeaderProps {
  workspace: StudentWorkspaceViewModel;
}

export function StudentWorkspaceHeader({
  workspace,
}: StudentWorkspaceHeaderProps) {
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          <Link
            to="/etablissement/eleves"
            className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-brand underline-offset-2 hover:underline"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Retour à la liste des élèves
          </Link>

          <div>
            <h1 className="truncate text-2xl font-bold text-ink">
              {workspace.displayName}
            </h1>
            <p className="mt-1 text-sm text-muted">
              Matricule : {workspace.matriculeLabel}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={workspace.isActive ? "success" : "neutral"}>
            {workspace.activeStatusLabel}
          </Badge>
          <StatusBadge status={workspace.enrollmentStatusLabel} />
        </div>
      </div>

      <dl className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
            Classe actuelle
          </dt>
          <dd className="mt-1 font-medium text-ink">{workspace.classLabel}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
            Année scolaire
          </dt>
          <dd className="mt-1 font-medium text-ink">
            {workspace.academicYearLabel}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
            Statut d&apos;inscription
          </dt>
          <dd className="mt-1 font-medium text-ink">
            {workspace.enrollmentStatusLabel}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
            Établissement
          </dt>
          <dd className="mt-1 font-medium text-ink">
            {workspace.schoolNameLabel}
          </dd>
        </div>
      </dl>
    </Card>
  );
}
